const DEFAULT_TEMPO_QUESTION_SECONDS = 10

export const MATCH_IN_PROGRESS_GRACE_MS = 2 * 60 * 1000

export function challengeRunDurationSeconds(config: {
  challengeMode: string | null
  durationSeconds: number
  questionCount: number | null
  perQuestionTimeLimitSeconds: number | null
}) {
  if (config.challengeMode === 'tempo') {
    const questionCount = Math.max(1, config.questionCount ?? 1)
    const perQuestionSeconds = Math.max(1, config.perQuestionTimeLimitSeconds ?? DEFAULT_TEMPO_QUESTION_SECONDS)

    return questionCount * perQuestionSeconds
  }

  return Math.max(1, config.durationSeconds)
}
