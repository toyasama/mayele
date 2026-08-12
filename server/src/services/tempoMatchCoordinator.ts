import { randomUUID } from 'node:crypto'
import type { Prisma } from '../generated/prisma/client.js'
import { generateMatchQuestion } from '../domain/matchQuestions.js'
import { calculateAnswerScorePoints, calculateSessionScorePoints } from '../domain/scoring.js'
import { prisma } from '../lib/prisma.js'
import type { GameLevel, GameType } from '../domain/constants.js'
import type { TempoAnswerPayload } from '../schemas/matchSchema.js'
import { MatchServiceError } from './matchServiceErrors.js'
import {
  calculateAccuracy,
  expectedTempoQuestion,
  recomputeBestStreak,
} from './matchServiceResults.js'
import { MATCH_INCLUDE, toMatchView, type MatchView } from './matchServiceView.js'
import type { SerializedMatch } from './matchPresenter.js'

const TEMPO_ARRIVAL_GRACE_MS = 1_500

type AtomicTempoAnswerRow = {
  inserted: boolean
  eligible: boolean
  duplicate: boolean
  answered_count: bigint | number
  expected_count: bigint | number
  current_index: number
  question_started_at: Date | null
  question_deadline_at: Date | null
  started_at: Date
  status: string
  participant_progress: unknown
  terminal: boolean
  advanced: boolean
}

export type PersistedTempoProgress = {
  questionIndex: number
  answeredCount: number
  expectedAnswerCount: number
  complete: boolean
  nextQuestionIndex: number
}

type LockedTempoMatch = Prisma.MatchGetPayload<{ include: typeof MATCH_INCLUDE }>

function activeParticipants(match: LockedTempoMatch) {
  return match.participants.filter((participant) =>
    participant.status === 'playing' || participant.status === 'submitting' || participant.status === 'completed',
  )
}

function assertTempoRuntime(match: LockedTempoMatch) {
  if (
    match.challengeMode !== 'tempo' ||
    !match.questionSeed ||
    !match.questionCount ||
    !match.perQuestionTimeLimitSeconds ||
    !match.startedAt
  ) {
    throw new MatchServiceError('match_config_incomplete')
  }
}

async function lockMatch(tx: Prisma.TransactionClient, matchId: string) {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "matches"
    WHERE "id" = ${matchId}
    FOR UPDATE
  `
}

async function updateParticipantFromAnswers(
  tx: Prisma.TransactionClient,
  match: LockedTempoMatch,
  playerId: string,
) {
  const participant = match.participants.find((item) => item.playerId === playerId)
  if (!participant) return

  const answers = await tx.matchQuestionAnswer.findMany({
    where: { matchId: match.id, playerId },
    orderBy: { questionIndex: 'asc' },
  })
  const evaluatedAnswers = answers.map((answer) => ({
    responseTimeMs: answer.responseTimeMs,
    isCorrect: answer.userAnswer === answer.correctAnswer,
  }))
  const correctAnswers = evaluatedAnswers.filter((answer) => answer.isCorrect).length

  await tx.matchParticipant.update({
    where: { id: participant.id },
    data: {
      score: calculateAccuracy(correctAnswers, evaluatedAnswers.length),
      scorePoints: calculateSessionScorePoints(match.level as GameLevel, evaluatedAnswers),
      correctAnswers,
      totalQuestions: evaluatedAnswers.length,
      totalResponseTimeMs: answers.reduce((sum, answer) => sum + answer.responseTimeMs, 0),
      bestStreak: recomputeBestStreak(evaluatedAnswers),
    },
  })
}

async function persistedProgress(
  tx: Prisma.TransactionClient,
  match: LockedTempoMatch,
  questionIndex: number,
): Promise<PersistedTempoProgress> {
  const expectedAnswerCount = activeParticipants(match).length
  const answeredCount = await tx.matchQuestionAnswer.count({
    where: { matchId: match.id, questionIndex },
  })

  return {
    questionIndex,
    answeredCount,
    expectedAnswerCount,
    complete: expectedAnswerCount > 0 && answeredCount >= expectedAnswerCount,
    nextQuestionIndex: questionIndex + 1,
  }
}

async function advanceTempoQuestion(
  tx: Prisma.TransactionClient,
  match: LockedTempoMatch,
  questionIndex: number,
  now: Date,
) {
  if (questionIndex + 1 >= match.questionCount!) {
    await tx.match.update({
      where: { id: match.id },
      data: {
        tempoQuestionIndex: match.questionCount,
        tempoQuestionAnswerCount: 0,
        tempoQuestionStartedAt: null,
        tempoQuestionDeadlineAt: null,
      },
    })
    return true
  }

  await tx.match.update({
    where: { id: match.id },
    data: {
      tempoQuestionIndex: questionIndex + 1,
      tempoQuestionAnswerCount: 0,
      tempoQuestionStartedAt: now,
      tempoQuestionDeadlineAt: new Date(now.getTime() + match.perQuestionTimeLimitSeconds! * 1_000),
    },
  })
  return false
}

export async function submitPersistedTempoAnswer(
  playerId: string,
  matchId: string,
  payload: TempoAnswerPayload,
) {
  return prisma.$transaction(async (tx) => {
    await lockMatch(tx, matchId)
    const match = await tx.match.findFirst({
      where: { id: matchId, participants: { some: { playerId } } },
      include: MATCH_INCLUDE,
    })

    if (!match) throw new MatchServiceError('match_not_found')
    assertTempoRuntime(match)
    expectedTempoQuestion(match, payload)

    const existing = await tx.matchQuestionAnswer.findUnique({
      where: {
        matchId_playerId_questionIndex: {
          matchId,
          playerId,
          questionIndex: payload.questionIndex,
        },
      },
    })

    if (existing) {
      const progress = await persistedProgress(tx, match, payload.questionIndex)
      return {
        match: toMatchView(match),
        progress,
        isDuplicate: true,
        advanced: (match.tempoQuestionIndex ?? 0) > payload.questionIndex,
        terminal: (match.tempoQuestionIndex ?? 0) >= match.questionCount!,
      }
    }

    if (match.status !== 'in_progress') throw new MatchServiceError('match_not_in_progress')
    const participant = match.participants.find((item) => item.playerId === playerId)
    if (!participant || participant.status !== 'playing') throw new MatchServiceError('match_not_participant')

    const currentQuestionIndex = match.tempoQuestionIndex ?? 0
    if (payload.questionIndex !== currentQuestionIndex) throw new MatchServiceError('match_tempo_answer_invalid')

    const deadline = match.tempoQuestionDeadlineAt ?? new Date(
      (match.tempoQuestionStartedAt ?? match.startedAt!).getTime() + match.perQuestionTimeLimitSeconds! * 1_000,
    )
    const now = new Date()
    if (now.getTime() > deadline.getTime() + TEMPO_ARRIVAL_GRACE_MS) {
      throw new MatchServiceError('match_tempo_answer_invalid')
    }

    await tx.matchQuestionAnswer.create({
      data: {
        matchId,
        playerId,
        questionIndex: payload.questionIndex,
        prompt: payload.prompt,
        correctAnswer: payload.correctAnswer,
        userAnswer: payload.userAnswer,
        responseTimeMs: payload.responseTimeMs,
        skill: payload.skill,
      },
    })
    await updateParticipantFromAnswers(tx, match, playerId)

    const progress = await persistedProgress(tx, match, payload.questionIndex)
    const terminal = progress.complete
      ? await advanceTempoQuestion(tx, match, payload.questionIndex, now)
      : false
    const persistedMatch = await tx.match.findUniqueOrThrow({
      where: { id: matchId },
      include: MATCH_INCLUDE,
    })

    return {
      match: toMatchView(persistedMatch),
      progress,
      isDuplicate: false,
      advanced: progress.complete,
      terminal,
    }
  }, { maxWait: 5_000, timeout: 15_000 })
}

function timeoutAnswer(match: LockedTempoMatch, questionIndex: number): TempoAnswerPayload {
  const expected = generateMatchQuestion(
    match.questionSeed!,
    questionIndex,
    match.game as GameType,
    match.level as GameLevel,
  )

  return {
    questionIndex,
    prompt: expected.prompt,
    correctAnswer: expected.answer,
    userAnswer: null,
    responseTimeMs: match.perQuestionTimeLimitSeconds! * 1_000,
    skill: expected.skill,
    source: 'timeout',
  }
}

export type ExpiredTempoQuestion = {
  match: MatchView
  progress: PersistedTempoProgress
  timedOutPlayerIds: string[]
  terminal: boolean
}

function validateKnownTempoSnapshot(snapshot: SerializedMatch, playerId: string, payload: TempoAnswerPayload) {
  if (
    snapshot.challengeMode !== 'tempo' ||
    !snapshot.questionSeed ||
    !snapshot.questionCount ||
    !snapshot.perQuestionTimeLimitSeconds
  ) {
    throw new MatchServiceError('match_not_in_progress')
  }
  if (!snapshot.participants.some((participant) => participant.player.id === playerId)) {
    throw new MatchServiceError('match_not_participant')
  }

  expectedTempoQuestion({
    ...snapshot,
    startedAt: snapshot.startedAt ? new Date(snapshot.startedAt) : new Date(0),
  }, payload)
}

type AtomicParticipantProgress = {
  player_id: string
  status: SerializedMatch['participants'][number]['status']
  score: number | null
  score_points: number
  correct_answers: number
  total_questions: number
  total_response_time_ms: number
  best_streak: number
}

function atomicParticipantProgress(value: unknown) {
  return Array.isArray(value) ? value as AtomicParticipantProgress[] : []
}

function atomicTempoSnapshot(
  snapshot: SerializedMatch,
  row: AtomicTempoAnswerRow,
): SerializedMatch {
  const progressByPlayerId = new Map(
    atomicParticipantProgress(row.participant_progress).map((progress) => [progress.player_id, progress]),
  )

  return {
    ...snapshot,
    status: row.status as SerializedMatch['status'],
    startedAt: row.started_at.toISOString(),
    serverNow: new Date().toISOString(),
    tempoQuestionIndex: row.current_index,
    tempoQuestionStartedAt: row.question_started_at?.toISOString() ?? null,
    tempoQuestionDeadlineAt: row.question_deadline_at?.toISOString() ?? null,
    participants: snapshot.participants.map((participant) => {
      const progress = progressByPlayerId.get(participant.player.id)
      if (!progress) return participant

      return {
        ...participant,
        status: progress.status,
        score: progress.score,
        scorePoints: progress.score_points,
        correctAnswers: progress.correct_answers,
        totalQuestions: progress.total_questions,
        totalResponseTimeMs: progress.total_response_time_ms,
        bestStreak: progress.best_streak,
      }
    }),
  }
}

/**
 * Critical realtime path: PostgreSQL owns serialization. The match keeps the
 * current question's durable answer count so a relative UPDATE can safely
 * observe a concurrent writer after waiting for the row lock, in one roundtrip.
 */
export async function submitAtomicTempoAnswer(
  playerId: string,
  matchId: string,
  payload: TempoAnswerPayload,
  knownSnapshot: SerializedMatch,
) {
  validateKnownTempoSnapshot(knownSnapshot, playerId, payload)
  const isCorrect = payload.userAnswer !== null && payload.userAnswer === payload.correctAnswer
  const answerScorePoints = calculateAnswerScorePoints(
    knownSnapshot.level as GameLevel,
    payload.responseTimeMs,
    isCorrect,
  )
  const correctIncrement = isCorrect ? 1 : 0

  const rows = await prisma.$queryRaw<AtomicTempoAnswerRow[]>`
    WITH locked_match AS MATERIALIZED (
      SELECT
        "id",
        "status",
        "challenge_mode",
        COALESCE("tempo_question_index", 0) AS "current_index",
        "tempo_question_answer_count" AS "answer_count",
        "question_count",
        "per_question_time_limit_seconds",
        "started_at",
        "tempo_question_started_at",
        "tempo_question_deadline_at"
      FROM "matches"
      WHERE "id" = ${matchId}
      FOR UPDATE
    ), eligible AS (
      SELECT lm.*
      FROM locked_match lm
      WHERE lm."status" = 'in_progress'
        AND lm."challenge_mode" = 'tempo'
        AND lm."current_index" = ${payload.questionIndex}
        AND lm."tempo_question_deadline_at" + INTERVAL '1500 milliseconds' >= CURRENT_TIMESTAMP
        AND EXISTS (
          SELECT 1
          FROM "match_participants" mp
          WHERE mp."match_id" = lm."id"
            AND mp."player_id" = ${playerId}
            AND mp."status" = 'playing'
        )
    ), inserted AS (
      INSERT INTO "match_question_answers" (
        "id", "match_id", "player_id", "question_index", "prompt",
        "correct_answer", "user_answer", "response_time_ms", "skill", "answered_at"
      )
      SELECT
        ${`answer_${randomUUID()}`}, e."id", ${playerId}, ${payload.questionIndex}, ${payload.prompt},
        ${payload.correctAnswer}, ${payload.userAnswer}, ${payload.responseTimeMs}, ${payload.skill}, CURRENT_TIMESTAMP
      FROM eligible e
      ON CONFLICT ("match_id", "player_id", "question_index") DO NOTHING
      RETURNING "question_index", "user_answer", "correct_answer"
    ), counts AS (
      SELECT
        EXISTS (SELECT 1 FROM eligible) AS "eligible",
        EXISTS (SELECT 1 FROM inserted) AS "inserted",
        EXISTS (
          SELECT 1 FROM "match_question_answers"
          WHERE "match_id" = ${matchId}
            AND "player_id" = ${playerId}
            AND "question_index" = ${payload.questionIndex}
        ) AS "duplicate",
        CASE
          WHEN EXISTS (SELECT 1 FROM eligible)
            THEN lm."answer_count" + (SELECT COUNT(*) FROM inserted)
          ELSE (
            SELECT COUNT(*) FROM "match_question_answers"
            WHERE "match_id" = ${matchId} AND "question_index" = ${payload.questionIndex}
          )
        END AS "answered_count",
        (
          SELECT COUNT(*) FROM "match_participants"
          WHERE "match_id" = ${matchId}
            AND "status" IN ('playing', 'submitting', 'completed')
        ) AS "expected_count"
      FROM locked_match lm
    ), answer_history AS (
      SELECT
        a."question_index",
        a."user_answer" IS NOT NULL AND a."user_answer" = a."correct_answer" AS "is_correct"
      FROM "match_question_answers" a
      WHERE a."match_id" = ${matchId}
        AND a."player_id" = ${playerId}

      UNION ALL

      SELECT
        i."question_index",
        i."user_answer" IS NOT NULL AND i."user_answer" = i."correct_answer" AS "is_correct"
      FROM inserted i
    ), streak_groups AS (
      SELECT
        "is_correct",
        SUM(CASE WHEN "is_correct" THEN 0 ELSE 1 END) OVER (ORDER BY "question_index") AS "streak_group"
      FROM answer_history
    ), computed_best_streak AS (
      SELECT COALESCE(MAX("streak_length"), 0)::INTEGER AS "value"
      FROM (
        SELECT COUNT(*)::INTEGER AS "streak_length"
        FROM streak_groups
        WHERE "is_correct"
        GROUP BY "streak_group"
      ) streaks
    ), participant_updated AS (
      UPDATE "match_participants" mp
      SET
        "correct_answers" = mp."correct_answers" + ${correctIncrement},
        "total_questions" = mp."total_questions" + 1,
        "total_response_time_ms" = mp."total_response_time_ms" + ${payload.responseTimeMs},
        "score_points" = mp."score_points" + ${answerScorePoints},
        "score" = ROUND(
          ((mp."correct_answers" + ${correctIncrement}) * 100.0) /
          (mp."total_questions" + 1)
        )::INTEGER,
        "best_streak" = GREATEST(mp."best_streak", computed_best_streak."value")
      FROM counts c, computed_best_streak
      WHERE mp."match_id" = ${matchId}
        AND mp."player_id" = ${playerId}
        AND c."inserted"
      RETURNING
        mp."id",
        mp."player_id",
        mp."status",
        mp."score",
        mp."score_points",
        mp."correct_answers",
        mp."total_questions",
        mp."total_response_time_ms",
        mp."best_streak"
    ), state_updated AS (
      UPDATE "matches" m
      SET
        "tempo_question_index" = CASE
          WHEN c."answered_count" < c."expected_count" THEN lm."current_index"
          WHEN lm."current_index" + 1 >= lm."question_count" THEN lm."question_count"
          ELSE lm."current_index" + 1
        END,
        "tempo_question_answer_count" = CASE
          WHEN c."answered_count" >= c."expected_count" THEN 0
          ELSE c."answered_count"
        END,
        "tempo_question_started_at" = CASE
          WHEN c."answered_count" < c."expected_count" THEN lm."tempo_question_started_at"
          WHEN lm."current_index" + 1 >= lm."question_count" THEN NULL
          ELSE CURRENT_TIMESTAMP
        END,
        "tempo_question_deadline_at" = CASE
          WHEN c."answered_count" < c."expected_count" THEN lm."tempo_question_deadline_at"
          WHEN lm."current_index" + 1 >= lm."question_count" THEN NULL
          ELSE CURRENT_TIMESTAMP + make_interval(secs => lm."per_question_time_limit_seconds")
        END
      FROM locked_match lm, counts c
      WHERE m."id" = lm."id"
        AND c."eligible"
        AND c."inserted"
        AND c."expected_count" > 0
      RETURNING
        m."tempo_question_index" AS "current_index",
        m."tempo_question_started_at" AS "question_started_at",
        m."tempo_question_deadline_at" AS "question_deadline_at"
    ), participant_progress AS (
      SELECT jsonb_agg(jsonb_build_object(
        'player_id', mp."player_id",
        'status', COALESCE(pu."status", mp."status"),
        'score', CASE WHEN pu."id" IS NOT NULL THEN pu."score" ELSE mp."score" END,
        'score_points', COALESCE(pu."score_points", mp."score_points"),
        'correct_answers', COALESCE(pu."correct_answers", mp."correct_answers"),
        'total_questions', COALESCE(pu."total_questions", mp."total_questions"),
        'total_response_time_ms', COALESCE(pu."total_response_time_ms", mp."total_response_time_ms"),
        'best_streak', COALESCE(pu."best_streak", mp."best_streak")
      )) AS "value"
      FROM "match_participants" mp
      LEFT JOIN participant_updated pu ON pu."id" = mp."id"
      WHERE mp."match_id" = ${matchId}
    )
    SELECT
      c."inserted",
      c."eligible",
      c."duplicate",
      c."answered_count",
      c."expected_count",
      COALESCE(su."current_index", lm."current_index") AS "current_index",
      CASE WHEN su."current_index" IS NOT NULL THEN su."question_started_at" ELSE lm."tempo_question_started_at" END AS "question_started_at",
      CASE WHEN su."current_index" IS NOT NULL THEN su."question_deadline_at" ELSE lm."tempo_question_deadline_at" END AS "question_deadline_at",
      lm."started_at",
      lm."status",
      pp."value" AS "participant_progress",
      COALESCE(su."current_index", lm."current_index") >= lm."question_count" AS "terminal",
      COALESCE(su."current_index", lm."current_index") > lm."current_index" AS "advanced"
    FROM locked_match lm
    CROSS JOIN counts c
    CROSS JOIN participant_progress pp
    LEFT JOIN state_updated su ON TRUE
  `
  const row = rows[0]
  if (!row) throw new MatchServiceError('match_not_found')
  if (!row.eligible && !row.duplicate) throw new MatchServiceError('match_tempo_answer_invalid')

  const answeredCount = Number(row.answered_count)
  const expectedAnswerCount = Number(row.expected_count)
  const progress: PersistedTempoProgress = {
    questionIndex: payload.questionIndex,
    answeredCount,
    expectedAnswerCount,
    complete: expectedAnswerCount > 0 && answeredCount >= expectedAnswerCount,
    nextQuestionIndex: payload.questionIndex + 1,
  }

  return {
    snapshot: atomicTempoSnapshot(knownSnapshot, row),
    progress,
    isDuplicate: !row.inserted,
    advanced: row.advanced,
    terminal: row.terminal,
  }
}

export async function processExpiredTempoQuestions(limit = 10): Promise<ExpiredTempoQuestion[]> {
  return prisma.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "matches"
      WHERE "status" = 'in_progress'
        AND "challenge_mode" = 'tempo'
        AND (
          "tempo_question_index" >= "question_count"
          OR "tempo_question_deadline_at" <= CURRENT_TIMESTAMP
        )
      ORDER BY "tempo_question_deadline_at" ASC NULLS FIRST
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    `
    const resolved: ExpiredTempoQuestion[] = []

    for (const candidate of candidates) {
      const match = await tx.match.findUnique({ where: { id: candidate.id }, include: MATCH_INCLUDE })
      if (!match) continue
      assertTempoRuntime(match)

      const questionIndex = match.tempoQuestionIndex ?? 0
      if (questionIndex >= match.questionCount!) {
        resolved.push({
          match: toMatchView(match),
          progress: {
            questionIndex: Math.max(0, match.questionCount! - 1),
            answeredCount: activeParticipants(match).length,
            expectedAnswerCount: activeParticipants(match).length,
            complete: true,
            nextQuestionIndex: match.questionCount!,
          },
          timedOutPlayerIds: [],
          terminal: true,
        })
        continue
      }

      const expectedPlayers = activeParticipants(match)
      const existingAnswers = await tx.matchQuestionAnswer.findMany({
        where: { matchId: match.id, questionIndex },
        select: { playerId: true },
      })
      const answeredPlayerIds = new Set(existingAnswers.map((answer) => answer.playerId))
      const timedOutPlayerIds: string[] = []
      const answer = timeoutAnswer(match, questionIndex)

      for (const participant of expectedPlayers) {
        if (answeredPlayerIds.has(participant.playerId)) continue
        await tx.matchQuestionAnswer.create({
          data: {
            matchId: match.id,
            playerId: participant.playerId,
            questionIndex,
            prompt: answer.prompt,
            correctAnswer: answer.correctAnswer,
            userAnswer: null,
            responseTimeMs: answer.responseTimeMs,
            skill: answer.skill,
          },
        })
        await updateParticipantFromAnswers(tx, match, participant.playerId)
        timedOutPlayerIds.push(participant.playerId)
      }

      const progress = await persistedProgress(tx, match, questionIndex)
      const terminal = await advanceTempoQuestion(tx, match, questionIndex, new Date())
      const persistedMatch = await tx.match.findUniqueOrThrow({ where: { id: match.id }, include: MATCH_INCLUDE })
      resolved.push({
        match: toMatchView(persistedMatch),
        progress,
        timedOutPlayerIds,
        terminal,
      })
    }

    return resolved
  }, { maxWait: 5_000, timeout: 20_000 })
}
