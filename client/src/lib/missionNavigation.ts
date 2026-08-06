import type { DailyMission, MissionLaunchConfig } from './api'

const MISSION_LEVEL_LABELS: Record<MissionLaunchConfig['level'], string> = {
  debutant: 'Débutant',
  intermediaire: 'Intermédiaire',
  avance: 'Avancé',
  expert: 'Expert',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isDailyMissionV2(value: unknown): value is DailyMission {
  if (!isRecord(value) || !isRecord(value.requirements) || !isRecord(value.launchConfig)) {
    return false
  }

  const requirements = value.requirements
  const launchConfig = value.launchConfig

  return typeof value.key === 'string'
    && ['easy', 'medium', 'hard'].includes(String(value.tier))
    && (requirements.playContext === 'solo' || requirements.playContext === 'multiplayer')
    && (requirements.challengeMode === 'sprint' || requirements.challengeMode === 'tempo')
    && (launchConfig.playContext === 'solo' || launchConfig.playContext === 'multiplayer')
    && (launchConfig.challengeMode === 'sprint' || launchConfig.challengeMode === 'tempo')
    && typeof launchConfig.game === 'string'
    && typeof launchConfig.level === 'string'
}

export function missionLevelLabel(mission: Pick<DailyMission, 'launchConfig'>) {
  return MISSION_LEVEL_LABELS[mission.launchConfig.level]
}

export function missionConfigurationLabel(mission: Pick<DailyMission, 'launchConfig'>) {
  const config = mission.launchConfig
  if (config.challengeMode === 'sprint') {
    return `${config.sprintDurationSeconds ?? 60} s`
  }

  return `${config.tempoQuestionCount ?? 10} q · ${config.tempoQuestionSeconds ?? 10} s/q`
}

export function missionLaunchPath(mission: Pick<DailyMission, 'key' | 'launchConfig'>) {
  const config = mission.launchConfig
  const params = new URLSearchParams({
    mission: mission.key,
    playContext: config.playContext,
    mode: config.challengeMode,
    game: config.game,
    level: config.level,
  })

  if (config.challengeMode === 'sprint' && config.sprintDurationSeconds) {
    params.set('duration', String(config.sprintDurationSeconds))
  }

  if (config.challengeMode === 'tempo') {
    if (config.tempoQuestionCount) params.set('questions', String(config.tempoQuestionCount))
    if (config.tempoQuestionSeconds) params.set('questionSeconds', String(config.tempoQuestionSeconds))
  }

  const path = config.playContext === 'solo' ? '/jeu/solo' : '/jeu/multijoueur'
  return `${path}?${params.toString()}`
}

export function missionLaunchConfigFromSearch(searchParams: URLSearchParams): MissionLaunchConfig | null {
  if (!searchParams.get('mission')) return null

  const playContext = searchParams.get('playContext')
  const challengeMode = searchParams.get('mode')
  const game = searchParams.get('game')
  const level = searchParams.get('level')

  if (
    (playContext !== 'solo' && playContext !== 'multiplayer')
    || (challengeMode !== 'sprint' && challengeMode !== 'tempo')
    || !['addition', 'soustraction', 'multiplication', 'division', 'mixte'].includes(game ?? '')
    || !['debutant', 'intermediaire', 'avance', 'expert'].includes(level ?? '')
  ) {
    return null
  }

  const positiveNumber = (name: string) => {
    const rawValue = searchParams.get(name)
    if (!rawValue) return null
    const value = Number(rawValue)
    return Number.isFinite(value) && value > 0 ? value : null
  }
  const duration = positiveNumber('duration')
  const questions = positiveNumber('questions')
  const questionSeconds = positiveNumber('questionSeconds')

  return {
    playContext,
    challengeMode,
    game: game as MissionLaunchConfig['game'],
    level: level as MissionLaunchConfig['level'],
    sprintDurationSeconds: challengeMode === 'sprint' ? duration : null,
    tempoQuestionCount: challengeMode === 'tempo' ? questions : null,
    tempoQuestionSeconds: challengeMode === 'tempo' ? questionSeconds : null,
  }
}
