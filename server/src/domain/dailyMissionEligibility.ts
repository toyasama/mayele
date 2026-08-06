export const MIN_VALID_ANSWERS_PER_MISSION_SESSION = 1

type SoloRunMissionContext = {
  mode: string
  currentQuestionIndex: number
  questionCount: number
  endsAt: Date
}

type MatchMissionContext = {
  challengeMode: string | null
  startedAt: Date | null
  durationSeconds: number
  questionCount: number | null
}

export function countValidMissionAnswers(answers: Array<{ userAnswer: number | null }>) {
  return answers.filter((answer) => answer.userAnswer !== null).length
}

export function completedSoloRunForDailyMissions(run: SoloRunMissionContext, finishedAt: Date) {
  if (run.mode === 'tempo') {
    return run.questionCount > 0 && run.currentQuestionIndex >= run.questionCount
  }

  if (run.mode === 'sprint') {
    return finishedAt.getTime() >= run.endsAt.getTime()
  }

  return false
}

export function completedMatchForDailyMissions(
  match: MatchMissionContext,
  submittedAnswerCount: number,
  finishedAt: Date,
  forfeitedAt: Date | null = null,
) {
  if (forfeitedAt) {
    return false
  }

  if (match.challengeMode === 'tempo') {
    return Boolean(match.questionCount && submittedAnswerCount === match.questionCount)
  }

  if (match.challengeMode === 'sprint' && match.startedAt) {
    const expectedEndAt = match.startedAt.getTime() + match.durationSeconds * 1000
    return finishedAt.getTime() >= expectedEndAt
  }

  return false
}

export function qualifiesForDailyMissions(
  completedWithoutAbandonment: boolean,
  validAnswerCount: number,
) {
  return completedWithoutAbandonment
    && validAnswerCount >= MIN_VALID_ANSWERS_PER_MISSION_SESSION
}
