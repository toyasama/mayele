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
  todayQuestionsAnswered: number
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
  family: 'sessions' | 'correct_answers' | 'questions_answered'
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
    family: 'sessions',
    title: 'Prendre son élan',
    description: 'Terminer une partie aujourd’hui.',
    rewardXp: 30,
    scope: 'daily',
    target: 1,
    current: (stats) => stats.todaySessions,
  },
  {
    key: 'daily_two_sprints',
    family: 'sessions',
    title: 'Garder le rythme',
    description: 'Terminer 2 parties aujourd’hui.',
    rewardXp: 60,
    scope: 'daily',
    target: 2,
    current: (stats) => stats.todaySessions,
  },
  {
    key: 'daily_three_sprints',
    family: 'sessions',
    title: 'Faire une belle série',
    description: 'Terminer 3 parties aujourd’hui.',
    rewardXp: 90,
    scope: 'daily',
    target: 3,
    current: (stats) => stats.todaySessions,
  },
  {
    key: 'daily_ten_correct',
    family: 'correct_answers',
    title: 'Viser juste',
    description: 'Trouver 10 bonnes réponses aujourd’hui.',
    rewardXp: 40,
    scope: 'daily',
    target: 10,
    current: (stats) => stats.todayCorrectAnswers,
  },
  {
    key: 'daily_twenty_correct',
    family: 'correct_answers',
    title: 'Œil de lynx',
    description: 'Trouver 20 bonnes réponses aujourd’hui.',
    rewardXp: 75,
    scope: 'daily',
    target: 20,
    current: (stats) => stats.todayCorrectAnswers,
  },
  {
    key: 'daily_thirty_correct',
    family: 'correct_answers',
    title: 'Sans trembler',
    description: 'Trouver 30 bonnes réponses aujourd’hui.',
    rewardXp: 110,
    scope: 'daily',
    target: 30,
    current: (stats) => stats.todayCorrectAnswers,
  },
  {
    key: 'daily_ten_answers',
    family: 'questions_answered',
    title: 'Échauffement',
    description: 'Répondre à 10 questions aujourd’hui.',
    rewardXp: 35,
    scope: 'daily',
    target: 10,
    current: (stats) => stats.todayQuestionsAnswered,
  },
  {
    key: 'daily_twenty_answers',
    family: 'questions_answered',
    title: 'Plein régime',
    description: 'Répondre à 20 questions aujourd’hui.',
    rewardXp: 65,
    scope: 'daily',
    target: 20,
    current: (stats) => stats.todayQuestionsAnswered,
  },
  {
    key: 'daily_thirty_answers',
    family: 'questions_answered',
    title: 'Grand parcours',
    description: 'Répondre à 30 questions aujourd’hui.',
    rewardXp: 95,
    scope: 'daily',
    target: 30,
    current: (stats) => stats.todayQuestionsAnswered,
  },
]

const DAILY_MISSION_FAMILIES: MissionDefinition['family'][] = ['sessions', 'correct_answers', 'questions_answered']

function stableHash(value: string) {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function dayOrdinal(day: string) {
  const timestamp = Date.parse(`${day}T00:00:00.000Z`)
  return Number.isNaN(timestamp) ? stableHash(day) : Math.floor(timestamp / 86_400_000)
}

/**
 * Selects one mission per family. The supplied day is already the player's
 * local calendar day, so repeated calls are idempotent and consecutive days
 * rotate every family.
 */
export function selectDailyMissions(playerId: string, day: string) {
  const ordinal = dayOrdinal(day)

  return DAILY_MISSION_FAMILIES.map((family) => {
    const candidates = MISSION_CATALOG.filter((mission) => mission.family === family)
    const playerOffset = stableHash(`${playerId}:${family}`) % candidates.length
    return candidates[(playerOffset + ordinal) % candidates.length]
  })
}

function clampProgress(current: number, target: number) {
  if (target <= 0) {
    return 100
  }

  return Math.max(0, Math.min(100, Math.round((current / target) * 100)))
}

export function buildMissionStates(stats: MissionStats, completions: MissionCompletionRef[], day: string, playerId: string): MissionState[] {
  const completedByScope = new Map(completions.map((completion) => [`${completion.missionKey}:${completion.scopeKey}`, completion]))

  return selectDailyMissions(playerId, day).map((mission) => {
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
  bestStreak: number
  fastCorrectAnswers2500: number
  fastCorrectAnswers1800: number
  fastCorrectAnswers1200: number
}

export type MasterySprintItem = {
  game: string
  level: string
  correctAnswers: number
  totalQuestions: number
  durationSeconds: number
}

type MasteryTier = 'confirmed' | 'master'

type MasterySprintPerformance = {
  accuracy: number
  cadence: number
  progress: number
  completed: boolean
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

export const MASTERY_ACCURACY_TARGETS: Record<MasteryTier, number> = {
  confirmed: 80,
  master: 95,
}

export const MASTERY_CADENCE_TARGETS: Record<MasteryTier, Record<GameLevel, number>> = {
  confirmed: {
    debutant: 12,
    intermediaire: 10,
    avance: 8,
    expert: 6,
  },
  master: {
    debutant: 18,
    intermediaire: 15,
    avance: 12,
    expert: 9,
  },
}

const BADGE_TIERS: Array<{
  tier: BadgeTier
  titlePrefix: string
  requirement: 'played' | MasteryTier
  description: (level: GameLevel, levelLabel: string) => string
}> = [
  {
    tier: 'discovery',
    titlePrefix: 'Jeune',
    requirement: 'played',
    description: (_level, levelLabel) => `Terminer un Sprint dans chaque type de calcul en ${levelLabel}.`,
  },
  {
    tier: 'confirmed',
    titlePrefix: 'Confirmé',
    requirement: 'confirmed',
    description: (level, levelLabel) => `Pour chaque type de calcul en ${levelLabel}, réussir un Sprint avec au moins ${MASTERY_ACCURACY_TARGETS.confirmed}% et ${MASTERY_CADENCE_TARGETS.confirmed[level]} bonnes réponses par minute.`,
  },
  {
    tier: 'master',
    titlePrefix: 'Maître',
    requirement: 'master',
    description: (level, levelLabel) => `Pour chaque type de calcul en ${levelLabel}, réussir un Sprint avec au moins ${MASTERY_ACCURACY_TARGETS.master}% et ${MASTERY_CADENCE_TARGETS.master[level]} bonnes réponses par minute.`,
  },
]

function masteryBadgeTitle(
  tier: (typeof BADGE_TIERS)[number],
  level: GameLevel,
  levelLabel: string,
) {
  if (tier.requirement === 'played') {
    return `${tier.titlePrefix} ${levelLabel}`
  }

  return `${tier.titlePrefix} ${levelLabel} · cadence ${MASTERY_CADENCE_TARGETS[tier.requirement][level]}/min`
}

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

function masterySprintPerformance(item: MasterySprintItem, tier: MasteryTier): MasterySprintPerformance | null {
  const level = item.level as GameLevel
  const accuracyTarget = MASTERY_ACCURACY_TARGETS[tier]
  const cadenceTarget = MASTERY_CADENCE_TARGETS[tier][level]

  if (!cadenceTarget || item.correctAnswers < 0 || item.totalQuestions <= 0 || item.durationSeconds <= 0) {
    return null
  }

  const exactAccuracy = (item.correctAnswers * 100) / item.totalQuestions
  const exactCadence = (item.correctAnswers * 60) / item.durationSeconds
  const accuracyProgress = exactAccuracy / accuracyTarget
  const cadenceProgress = exactCadence / cadenceTarget

  return {
    accuracy: Math.round(exactAccuracy * 10) / 10,
    cadence: Math.round(exactCadence * 10) / 10,
    progress: Math.min(accuracyProgress, cadenceProgress),
    completed:
      item.correctAnswers * 100 >= accuracyTarget * item.totalQuestions
      && item.correctAnswers * 60 >= cadenceTarget * item.durationSeconds,
  }
}

function buildMasteryPerformanceMap(items: MasterySprintItem[]) {
  const performances = new Map<string, MasterySprintPerformance>()

  for (const item of items) {
    for (const tier of ['confirmed', 'master'] as const) {
      const performance = masterySprintPerformance(item, tier)
      const key = `${item.level}:${item.game}:${tier}`
      const current = performances.get(key)

      if (
        performance
        && (!current || performance.progress > current.progress || (
          performance.progress === current.progress
          && performance.accuracy + performance.cadence > current.accuracy + current.cadence
        ))
      ) {
        performances.set(key, performance)
      }
    }
  }

  return performances
}

function objectiveDetail(
  item: BadgeProgressItem | undefined,
  requirement: 'played' | MasteryTier,
  performance: MasterySprintPerformance | undefined,
  level: GameLevel,
) {
  if (requirement === 'played') {
    if (!item || item.attempts <= 0) {
      return 'Aucun sprint'
    }

    return `${item.attempts} sprint${item.attempts > 1 ? 's' : ''}`
  }

  if (!performance) {
    return 'Aucun sprint'
  }

  return `Record ${String(performance.accuracy).replace('.', ',')}% · ${String(performance.cadence).replace('.', ',')}/${MASTERY_CADENCE_TARGETS[requirement][level]} rép./min`
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

export function buildBadgeStates(progressByMode: BadgeProgressItem[], masterySprints: MasterySprintItem[] = []): BadgeState[] {
  const progressMap = new Map(progressByMode.map((item) => [`${item.level}:${item.game}`, item]))
  const masteryPerformanceMap = buildMasteryPerformanceMap(masterySprints)

  const masteryBadges = VALID_LEVELS.flatMap((level) => {
    const levelLabel = LEVEL_LABELS[level]

    return BADGE_TIERS.map((tier) => {
      const objectives = VALID_GAMES.map((game) => {
        const item = progressMap.get(`${level}:${game}`)
        const performance = tier.requirement === 'played'
          ? undefined
          : masteryPerformanceMap.get(`${level}:${game}:${tier.requirement}`)
        const completed = tier.requirement === 'played' ? (item?.attempts ?? 0) > 0 : Boolean(performance?.completed)

        return {
          key: `${level}:${game}:${tier.requirement}`,
          label: `${GAME_LABELS[game]}`,
          completed,
          detail: objectiveDetail(item, tier.requirement, performance, level),
        }
      })
      const title = masteryBadgeTitle(tier, level, levelLabel)

      return buildBadgeState({
        key: `${tier.tier}_${level}`,
        title,
        description: tier.description(level, levelLabel),
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
