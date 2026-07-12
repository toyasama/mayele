import { VALID_GAMES, VALID_LEVELS, type GameLevel, type GameType } from './constants.js'

const GAME_LABELS: Record<GameType, string> = {
  addition: 'Addition',
  soustraction: 'Soustraction',
  multiplication: 'Multiplication',
  division: 'Division',
  mixte: 'Mixte',
}

const LEVEL_LABELS: Record<GameLevel, string> = {
  debutant: 'Débutant',
  intermediaire: 'Intermédiaire',
  avance: 'Avancé',
  expert: 'Expert',
}

export type MissionStats = {
  todaySessions: number
  todayCorrectAnswers: number
}

export type MissionCompletionRef = {
  missionKey: string
  scopeKey: string
  completedAt?: Date | string
  xpAwarded?: number
}

export type MissionState = {
  key: string
  title: string
  description: string
  rewardXp: number
  scope: 'daily' | 'lifetime'
  scopeKey: string
  current: number
  target: number
  progress: number
  completed: boolean
  claimed: boolean
  completedAt: string | null
}

type MissionDefinition = {
  key: string
  title: string
  description: string
  rewardXp: number
  scope: 'daily' | 'lifetime'
  target: number
  current: (stats: MissionStats) => number
}

export const MISSION_CATALOG: MissionDefinition[] = [
  {
    key: 'daily_first_sprint',
    title: 'Premier sprint',
    description: 'Terminer 1 sprint aujourd’hui.',
    rewardXp: 30,
    scope: 'daily',
    target: 1,
    current: (stats) => stats.todaySessions,
  },
  {
    key: 'daily_three_sprints',
    title: 'Routine du jour',
    description: 'Terminer 3 sprints aujourd’hui.',
    rewardXp: 90,
    scope: 'daily',
    target: 3,
    current: (stats) => stats.todaySessions,
  },
  {
    key: 'daily_twenty_correct',
    title: 'Précision du jour',
    description: 'Répondre juste à 20 questions aujourd’hui.',
    rewardXp: 120,
    scope: 'daily',
    target: 20,
    current: (stats) => stats.todayCorrectAnswers,
  },
]

function clampProgress(current: number, target: number) {
  if (target <= 0) {
    return 100
  }

  return Math.max(0, Math.min(100, Math.round((current / target) * 100)))
}

export function buildMissionStates(stats: MissionStats, completions: MissionCompletionRef[], day: string): MissionState[] {
  const completedByScope = new Map(completions.map((completion) => [`${completion.missionKey}:${completion.scopeKey}`, completion]))

  return MISSION_CATALOG.map((mission) => {
    const scopeKey = mission.scope === 'daily' ? day : 'lifetime'
    const completion = completedByScope.get(`${mission.key}:${scopeKey}`)
    const current = Math.min(mission.target, Math.max(0, mission.current(stats)))
    const completed = current >= mission.target || Boolean(completion)

    return {
      key: mission.key,
      title: mission.title,
      description: mission.description,
      rewardXp: mission.rewardXp,
      scope: mission.scope,
      scopeKey,
      current: completed ? mission.target : current,
      target: mission.target,
      progress: completed ? 100 : clampProgress(current, mission.target),
      completed,
      claimed: Boolean(completion),
      completedAt: completion?.completedAt ? new Date(completion.completedAt).toISOString() : null,
    }
  })
}

export type BadgeProgressItem = {
  game: string
  level: string
  attempts: number
  bestScore: number
  bestCorrectAnswers: number
  bestStreak: number
  hasQualifiedScore80: boolean
  hasQualifiedScore100: boolean
  fastCorrectAnswers2500: number
  fastCorrectAnswers1800: number
  fastCorrectAnswers1200: number
}

type BadgeFamily = 'mastery' | 'speed' | 'streak' | 'volume'
type BadgeTier =
  | 'discovery'
  | 'confirmed'
  | 'master'
  | 'sprinter_apprentice'
  | 'sprinter_sharp'
  | 'sprinter_flash'
  | 'streak_stable'
  | 'streak_solid'
  | 'streak_long'
  | 'volume_regular'
  | 'volume_pillar'
  | 'volume_marathon'

export type BadgeState = {
  key: string
  title: string
  description: string
  family: BadgeFamily
  familyLabel: string
  familyDescription: string
  tier: BadgeTier
  level: GameLevel
  completed: boolean
  progress: number
  completedObjectives: number
  totalObjectives: number
  objectives: Array<{
    key: string
    label: string
    completed: boolean
    detail: string
  }>
}

const BADGE_FAMILIES: Record<BadgeFamily, { label: string; description: string }> = {
  mastery: {
    label: 'Parcours',
    description: 'Explorer, consolider puis maîtriser chaque niveau.',
  },
  speed: {
    label: 'Vitesse',
    description: 'Répondre juste avec un temps très court, mode par mode.',
  },
  streak: {
    label: 'Séries',
    description: 'Enchaîner les bonnes réponses sans casser le rythme.',
  },
  volume: {
    label: 'Volume',
    description: 'Construire une pratique régulière sur tous les modes.',
  },
}

export const MASTERY_CONFIRMED_MIN_CORRECT_ANSWERS = 10
export const MASTERY_MASTER_MIN_CORRECT_ANSWERS = 20

const BADGE_TIERS: Array<{
  tier: BadgeTier
  titlePrefix: string
  requirement: 'played' | 'score80' | 'score100'
  description: (levelLabel: string) => string
}> = [
  {
    tier: 'discovery',
    titlePrefix: 'Jeune',
    requirement: 'played',
    description: (levelLabel) => `Jouer au moins une fois chaque mode en ${levelLabel}.`,
  },
  {
    tier: 'confirmed',
    titlePrefix: 'Confirmé',
    requirement: 'score80',
    description: (levelLabel) => `Atteindre 80% ou plus avec au moins ${MASTERY_CONFIRMED_MIN_CORRECT_ANSWERS} bonnes réponses sur chaque mode en ${levelLabel}.`,
  },
  {
    tier: 'master',
    titlePrefix: 'Maître',
    requirement: 'score100',
    description: (levelLabel) => `Réussir 100% avec au moins ${MASTERY_MASTER_MIN_CORRECT_ANSWERS} bonnes réponses sur chaque mode en ${levelLabel}.`,
  },
]

const SPEED_BADGE_TIERS: Array<{
  tier: BadgeTier
  titlePrefix: string
  target: number
  maxResponseTimeMs: number
  current: (item: BadgeProgressItem | undefined) => number
}> = [
  {
    tier: 'sprinter_apprentice',
    titlePrefix: 'Apprenti sprinteur',
    target: 25,
    maxResponseTimeMs: 2500,
    current: (item) => item?.fastCorrectAnswers2500 ?? 0,
  },
  {
    tier: 'sprinter_sharp',
    titlePrefix: 'Sprinteur précis',
    target: 75,
    maxResponseTimeMs: 1800,
    current: (item) => item?.fastCorrectAnswers1800 ?? 0,
  },
  {
    tier: 'sprinter_flash',
    titlePrefix: 'Sprinteur éclair',
    target: 150,
    maxResponseTimeMs: 1200,
    current: (item) => item?.fastCorrectAnswers1200 ?? 0,
  },
]

const STREAK_BADGE_TIERS: Array<{
  tier: BadgeTier
  titlePrefix: string
  target: number
}> = [
  { tier: 'streak_stable', titlePrefix: 'Série stable', target: 5 },
  { tier: 'streak_solid', titlePrefix: 'Série solide', target: 10 },
  { tier: 'streak_long', titlePrefix: 'Série longue', target: 20 },
]

const VOLUME_BADGE_TIERS: Array<{
  tier: BadgeTier
  titlePrefix: string
  target: number
}> = [
  { tier: 'volume_regular', titlePrefix: 'Habitué', target: 5 },
  { tier: 'volume_pillar', titlePrefix: 'Pilier', target: 20 },
  { tier: 'volume_marathon', titlePrefix: 'Marathonien', target: 50 },
]

function objectiveCompleted(item: BadgeProgressItem | undefined, requirement: 'played' | 'score80' | 'score100') {
  if (!item) {
    return false
  }

  if (requirement === 'played') {
    return item.attempts > 0
  }

  if (requirement === 'score80') {
    return item.hasQualifiedScore80
  }

  return item.hasQualifiedScore100
}

function objectiveDetail(item: BadgeProgressItem | undefined, requirement: 'played' | 'score80' | 'score100') {
  if (!item || item.attempts <= 0) {
    return 'Aucun sprint'
  }

  if (requirement === 'played') {
    return `${item.attempts} sprint${item.attempts > 1 ? 's' : ''}`
  }

  const target = requirement === 'score100' ? MASTERY_MASTER_MIN_CORRECT_ANSWERS : MASTERY_CONFIRMED_MIN_CORRECT_ANSWERS

  return `Record ${item.bestScore}% · ${Math.min(item.bestCorrectAnswers, target)}/${target} bonnes rép.`
}

function formatSeconds(milliseconds: number) {
  return `${String(milliseconds / 1000).replace('.', ',')}s`
}

function buildObjectiveState(options: {
  key: string
  label: string
  current: number
  target: number
  detail: string
}) {
  return {
    key: options.key,
    label: options.label,
    completed: options.current >= options.target,
    detail: options.detail,
  }
}

function buildBadgeState(options: {
  key: string
  family: BadgeFamily
  tier: BadgeTier
  level: GameLevel
  title: string
  description: string
  objectives: BadgeState['objectives']
}): BadgeState {
  const family = BADGE_FAMILIES[options.family]
  const completedObjectives = options.objectives.filter((objective) => objective.completed).length

  return {
    key: options.key,
    title: options.title,
    description: options.description,
    family: options.family,
    familyLabel: family.label,
    familyDescription: family.description,
    tier: options.tier,
    level: options.level,
    completed: completedObjectives === options.objectives.length,
    progress: clampProgress(completedObjectives, options.objectives.length),
    completedObjectives,
    totalObjectives: options.objectives.length,
    objectives: options.objectives,
  }
}

export function buildBadgeStates(progressByMode: BadgeProgressItem[]): BadgeState[] {
  const progressMap = new Map(progressByMode.map((item) => [`${item.level}:${item.game}`, item]))

  const masteryBadges = VALID_LEVELS.flatMap((level) => {
    const levelLabel = LEVEL_LABELS[level]

    return BADGE_TIERS.map((tier) => {
      const objectives = VALID_GAMES.map((game) => {
        const item = progressMap.get(`${level}:${game}`)
        const completed = objectiveCompleted(item, tier.requirement)

        return {
          key: `${level}:${game}:${tier.requirement}`,
          label: `${GAME_LABELS[game]}`,
          completed,
          detail: objectiveDetail(item, tier.requirement),
        }
      })
      const title = `${tier.titlePrefix} ${levelLabel}`

      return buildBadgeState({
        key: `${tier.tier}_${level}`,
        title,
        description: tier.description(levelLabel),
        family: 'mastery',
        tier: tier.tier,
        level,
        objectives,
      })
    })
  })

  const speedBadges = VALID_LEVELS.flatMap((level) => {
    const levelLabel = LEVEL_LABELS[level]

    return SPEED_BADGE_TIERS.map((tier) => {
      const objectives = VALID_GAMES.map((game) => {
        const item = progressMap.get(`${level}:${game}`)
        const current = tier.current(item)

        return buildObjectiveState({
          key: `${level}:${game}:${tier.tier}`,
          label: GAME_LABELS[game],
          current,
          target: tier.target,
          detail: `${Math.min(current, tier.target)}/${tier.target} rapides · max ${formatSeconds(tier.maxResponseTimeMs)}`,
        })
      })

      return buildBadgeState({
        key: `${tier.tier}_${level}`,
        title: `${tier.titlePrefix} ${levelLabel}`,
        description: `${tier.target} bonnes réponses en ${formatSeconds(tier.maxResponseTimeMs)} ou moins sur chaque mode en ${levelLabel}.`,
        family: 'speed',
        tier: tier.tier,
        level,
        objectives,
      })
    })
  })

  const streakBadges = VALID_LEVELS.flatMap((level) => {
    const levelLabel = LEVEL_LABELS[level]

    return STREAK_BADGE_TIERS.map((tier) => {
      const objectives = VALID_GAMES.map((game) => {
        const item = progressMap.get(`${level}:${game}`)
        const current = item?.bestStreak ?? 0

        return buildObjectiveState({
          key: `${level}:${game}:${tier.tier}`,
          label: GAME_LABELS[game],
          current,
          target: tier.target,
          detail: `Série ${Math.min(current, tier.target)}/${tier.target}`,
        })
      })

      return buildBadgeState({
        key: `${tier.tier}_${level}`,
        title: `${tier.titlePrefix} ${levelLabel}`,
        description: `Atteindre une série de ${tier.target} sur chaque mode en ${levelLabel}.`,
        family: 'streak',
        tier: tier.tier,
        level,
        objectives,
      })
    })
  })

  const volumeBadges = VALID_LEVELS.flatMap((level) => {
    const levelLabel = LEVEL_LABELS[level]

    return VOLUME_BADGE_TIERS.map((tier) => {
      const objectives = VALID_GAMES.map((game) => {
        const item = progressMap.get(`${level}:${game}`)
        const current = item?.attempts ?? 0

        return buildObjectiveState({
          key: `${level}:${game}:${tier.tier}`,
          label: GAME_LABELS[game],
          current,
          target: tier.target,
          detail: `Sprints ${Math.min(current, tier.target)}/${tier.target}`,
        })
      })

      return buildBadgeState({
        key: `${tier.tier}_${level}`,
        title: `${tier.titlePrefix} ${levelLabel}`,
        description: `Terminer ${tier.target} sprints sur chaque mode en ${levelLabel}.`,
        family: 'volume',
        tier: tier.tier,
        level,
        objectives,
      })
    })
  })

  return [...masteryBadges, ...speedBadges, ...streakBadges, ...volumeBadges]
}
