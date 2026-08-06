import { VALID_GAMES, type GameLevel, type GameType } from './constants.js'

export const DAILY_MISSION_CATALOG_VERSION = 2

export const MISSION_TIERS = ['easy', 'medium', 'hard'] as const
export const MISSION_FAMILIES = [
  'sessions',
  'valid_answers',
  'correct_answers',
  'accuracy',
  'streak',
  'diversity',
] as const

export type MissionTier = (typeof MISSION_TIERS)[number]
export type MissionFamily = (typeof MISSION_FAMILIES)[number]
export type MissionPlayContext = 'solo' | 'multiplayer'
export type MissionChallengeMode = 'sprint' | 'tempo'
export type MissionDiversityKind = 'games' | 'configurations'

export type MissionLaunchConfig = {
  playContext: MissionPlayContext
  challengeMode: MissionChallengeMode
  game: GameType
  level: GameLevel
  sprintDurationSeconds: number | null
  tempoQuestionCount: number | null
  tempoQuestionSeconds: number | null
}

export type MissionRequirements = {
  playContext: MissionPlayContext
  challengeMode: MissionChallengeMode
  game: GameType | null
  level: GameLevel
  minSprintDurationSeconds: number | null
  minTempoQuestionCount: number | null
  maxTempoQuestionSeconds: number | null
  diversityKind: MissionDiversityKind | null
  recognizedConfigurationKeys: string[]
}

export type MissionDefinition = {
  version: number
  key: string
  family: MissionFamily
  familyLabel: string
  tier: MissionTier
  tierLabel: string
  title: string
  description: string
  rewardXp: number
  scope: 'daily'
  target: number
  minimumValidAnswers: number
  requirements: MissionRequirements
  launchConfig: MissionLaunchConfig
}

export type MissionCompletionRef = {
  missionKey: string
  scopeKey: string
  completedAt?: Date | string
  xpAwarded?: number
}

export type MissionSessionFact = {
  id: string
  playContext: string | null
  challengeMode: string | null
  game: string
  level: string
  configuredDurationSeconds: number | null
  configuredQuestionCount: number | null
  configuredQuestionSeconds: number | null
  validAnswers: number
  correctAnswers: number
  totalQuestions: number
  bestStreak: number
}

export type MissionState = MissionDefinition & {
  scopeKey: string
  current: number
  progress: number
  completed: boolean
  claimed: boolean
  completedAt: string | null
}

type TierProfile = {
  label: string
  rewardXp: number
  levels: readonly [GameLevel, GameLevel]
  sprintThresholds: readonly number[]
  tempoPresets: ReadonlyArray<readonly [questionCount: number, questionSeconds: number]>
  solo: ObjectiveTargets
  multiplayer: ObjectiveTargets
}

type ObjectiveTargets = {
  sessions: number
  valid_answers: number
  correct_answers: number
  accuracy: number
  accuracyMinimumValidAnswers: number
  streak: number
  diversity: number
}

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

const FAMILY_LABELS: Record<MissionFamily, string> = {
  sessions: 'Parties',
  valid_answers: 'Réponses',
  correct_answers: 'Précision',
  accuracy: 'Justesse',
  streak: 'Série',
  diversity: 'Diversité',
}

const FAMILY_TITLES: Record<MissionFamily, string> = {
  sessions: 'Aller au bout',
  valid_answers: 'Garder le rythme',
  correct_answers: 'Viser juste',
  accuracy: 'Soigner sa précision',
  streak: 'Enchaîner sans faute',
  diversity: 'Changer de terrain',
}

const TIER_PROFILES: Record<MissionTier, TierProfile> = {
  easy: {
    label: 'Facile',
    rewardXp: 40,
    levels: ['debutant', 'intermediaire'],
    sprintThresholds: [60, 90],
    tempoPresets: [[10, 20], [20, 20], [30, 15]],
    solo: {
      sessions: 1,
      valid_answers: 10,
      correct_answers: 8,
      accuracy: 80,
      accuracyMinimumValidAnswers: 10,
      streak: 5,
      diversity: 2,
    },
    multiplayer: {
      sessions: 1,
      valid_answers: 10,
      correct_answers: 8,
      accuracy: 75,
      accuracyMinimumValidAnswers: 8,
      streak: 4,
      diversity: 2,
    },
  },
  medium: {
    label: 'Intermédiaire',
    rewardXp: 80,
    levels: ['intermediaire', 'avance'],
    sprintThresholds: [60, 90, 120],
    tempoPresets: [[20, 15], [30, 12], [40, 10]],
    solo: {
      sessions: 2,
      valid_answers: 30,
      correct_answers: 24,
      accuracy: 90,
      accuracyMinimumValidAnswers: 15,
      streak: 10,
      diversity: 3,
    },
    multiplayer: {
      sessions: 1,
      valid_answers: 20,
      correct_answers: 16,
      accuracy: 85,
      accuracyMinimumValidAnswers: 12,
      streak: 8,
      diversity: 2,
    },
  },
  hard: {
    label: 'Difficile',
    rewardXp: 140,
    levels: ['avance', 'expert'],
    sprintThresholds: [90, 120],
    tempoPresets: [[30, 10], [40, 8], [50, 5]],
    solo: {
      sessions: 3,
      valid_answers: 60,
      correct_answers: 50,
      accuracy: 95,
      accuracyMinimumValidAnswers: 20,
      streak: 20,
      diversity: 4,
    },
    multiplayer: {
      sessions: 2,
      valid_answers: 35,
      correct_answers: 30,
      accuracy: 95,
      accuracyMinimumValidAnswers: 15,
      streak: 12,
      diversity: 3,
    },
  },
}

const FAMILY_DISTRIBUTION: Record<MissionFamily, readonly [number, number, number, number]> = {
  // Solo Sprint, Solo Tempo, Multijoueur Sprint, Multijoueur Tempo.
  sessions: [5, 5, 3, 3],
  valid_answers: [4, 4, 2, 2],
  correct_answers: [4, 4, 2, 2],
  accuracy: [3, 3, 1, 1],
  streak: [2, 2, 1, 1],
  diversity: [2, 2, 1, 1],
}

const CONTEXT_MODE_BUCKETS: ReadonlyArray<{
  playContext: MissionPlayContext
  challengeMode: MissionChallengeMode
}> = [
  { playContext: 'solo', challengeMode: 'sprint' },
  { playContext: 'solo', challengeMode: 'tempo' },
  { playContext: 'multiplayer', challengeMode: 'sprint' },
  { playContext: 'multiplayer', challengeMode: 'tempo' },
]

function plural(value: number, singular: string, pluralForm = `${singular}s`) {
  return value > 1 ? pluralForm : singular
}

function sprintConfigurationKey(durationSeconds: number) {
  return `sprint-${durationSeconds}`
}

function tempoConfigurationKey(questionCount: number, questionSeconds: number) {
  return `tempo-${questionCount}q-${questionSeconds}s`
}

function configLabel(requirements: MissionRequirements) {
  if (requirements.diversityKind === 'configurations') {
    return requirements.challengeMode === 'sprint'
      ? 'Sprint · durées reconnues'
      : 'Tempo · presets reconnus'
  }

  if (requirements.challengeMode === 'sprint') {
    return `Sprint ${requirements.minSprintDurationSeconds}s+`
  }

  return `Tempo ${requirements.minTempoQuestionCount}q · ${requirements.maxTempoQuestionSeconds}s max`
}

function contextLabel(playContext: MissionPlayContext) {
  return playContext === 'solo' ? 'Solo' : 'Multijoueur'
}

function requirementPhrase(requirements: MissionRequirements) {
  const where = requirements.playContext === 'solo' ? 'en Solo' : 'en multijoueur'
  const mode = requirements.diversityKind === 'configurations'
    ? requirements.challengeMode === 'sprint'
      ? 'sur des Sprints aux durées reconnues'
      : 'sur des Tempos aux presets reconnus'
    : requirements.challengeMode === 'sprint'
      ? `sur un Sprint d’au moins ${requirements.minSprintDurationSeconds} secondes`
      : `sur un Tempo d’au moins ${requirements.minTempoQuestionCount} questions avec ${requirements.maxTempoQuestionSeconds} secondes maximum par question`
  const game = requirements.game ? ` en ${GAME_LABELS[requirements.game]}` : ''

  return `${where}, ${mode}${game}, niveau ${LEVEL_LABELS[requirements.level]}`
}

function missionDescription(definition: Pick<MissionDefinition, 'family' | 'target' | 'minimumValidAnswers' | 'requirements'>) {
  const requirement = requirementPhrase(definition.requirements)
  const target = definition.target

  switch (definition.family) {
    case 'sessions':
      return `Termine ${target} ${plural(target, 'partie')} ${requirement}. Chaque partie doit être terminée sans abandon.`
    case 'valid_answers':
      return `Donne ${target} réponses valides au total ${requirement}, dans des parties terminées sans abandon.`
    case 'correct_answers':
      return `Trouve ${target} bonnes réponses au total ${requirement}, dans des parties terminées sans abandon.`
    case 'accuracy':
      return `Atteins ${target}% de réussite dans une même partie ${requirement}, avec au moins ${definition.minimumValidAnswers} réponses saisies.`
    case 'streak':
      return `Atteins une série de ${target} bonnes réponses dans une même partie ${requirement}.`
    case 'diversity':
      if (definition.requirements.diversityKind === 'configurations') {
        return `Utilise ${target} configurations reconnues distinctes ${requirement}. Chaque partie doit être terminée sans abandon.`
      }
      return `Utilise ${target} types de calcul distincts ${requirement}. Chaque partie doit être terminée sans abandon.`
  }
}

function objectiveTarget(profile: TierProfile, family: MissionFamily, playContext: MissionPlayContext) {
  const targets = profile[playContext]
  return targets[family]
}

function buildMissionDefinition(options: {
  catalogIndex: number
  tier: MissionTier
  tierIndex: number
  family: MissionFamily
  familyIndex: number
  bucketIndex: number
  itemIndex: number
  playContext: MissionPlayContext
  challengeMode: MissionChallengeMode
}): MissionDefinition {
  const profile = TIER_PROFILES[options.tier]
  const targets = profile[options.playContext]
  const level = profile.levels[(options.itemIndex + options.familyIndex + options.bucketIndex) % profile.levels.length]
  const gameIndex = options.catalogIndex % VALID_GAMES.length
  const launchGame = VALID_GAMES[gameIndex]
  let diversityKind: MissionDiversityKind | null = options.family === 'diversity'
    ? ((options.itemIndex + options.tierIndex + options.bucketIndex) % 2 === 0 ? 'games' : 'configurations')
    : null
  const sprintThreshold = profile.sprintThresholds[
    (options.itemIndex + options.familyIndex + options.bucketIndex) % profile.sprintThresholds.length
  ]
  const tempoPreset = profile.tempoPresets[
    (options.itemIndex + options.familyIndex + options.bucketIndex) % profile.tempoPresets.length
  ]
  const availableRecognizedConfigurationKeys = options.challengeMode === 'sprint'
    ? profile.sprintThresholds.map(sprintConfigurationKey)
    : profile.tempoPresets.map(([questions, seconds]) => tempoConfigurationKey(questions, seconds))
  if (diversityKind === 'configurations' && targets.diversity > availableRecognizedConfigurationKeys.length) {
    diversityKind = 'games'
  }
  const game = diversityKind ? null : launchGame
  const recognizedConfigurationKeys = diversityKind === 'configurations'
    ? availableRecognizedConfigurationKeys
    : []
  const requirements: MissionRequirements = {
    playContext: options.playContext,
    challengeMode: options.challengeMode,
    game,
    level,
    minSprintDurationSeconds: options.challengeMode === 'sprint' ? sprintThreshold : null,
    minTempoQuestionCount: options.challengeMode === 'tempo' ? tempoPreset[0] : null,
    maxTempoQuestionSeconds: options.challengeMode === 'tempo' ? tempoPreset[1] : null,
    diversityKind,
    recognizedConfigurationKeys,
  }
  const rawTarget = objectiveTarget(profile, options.family, options.playContext)
  const target = rawTarget
  const minimumValidAnswers = options.family === 'accuracy' ? targets.accuracyMinimumValidAnswers : 1
  const configCode = options.challengeMode === 'sprint'
    ? sprintConfigurationKey(sprintThreshold)
    : tempoConfigurationKey(tempoPreset[0], tempoPreset[1])
  const subjectCode = diversityKind ?? game
  const key = [
    'daily-v2',
    options.tier,
    options.family,
    options.playContext,
    options.challengeMode,
    level,
    subjectCode,
    configCode,
    `target-${target}`,
  ].join('_')
  const subjectLabel = diversityKind === 'games'
    ? 'Calculs variés'
    : diversityKind === 'configurations'
      ? 'Configurations variées'
      : GAME_LABELS[game!]
  const title = `${FAMILY_TITLES[options.family]} · ${subjectLabel} ${LEVEL_LABELS[level]} · ${configLabel(requirements)}`
  const launchConfig: MissionLaunchConfig = {
    playContext: options.playContext,
    challengeMode: options.challengeMode,
    game: launchGame,
    level,
    sprintDurationSeconds: options.challengeMode === 'sprint' ? sprintThreshold : null,
    tempoQuestionCount: options.challengeMode === 'tempo' ? tempoPreset[0] : null,
    tempoQuestionSeconds: options.challengeMode === 'tempo' ? tempoPreset[1] : null,
  }
  const definition: MissionDefinition = {
    version: DAILY_MISSION_CATALOG_VERSION,
    key,
    family: options.family,
    familyLabel: FAMILY_LABELS[options.family],
    tier: options.tier,
    tierLabel: profile.label,
    title,
    description: '',
    rewardXp: profile.rewardXp,
    scope: 'daily',
    target,
    minimumValidAnswers,
    requirements,
    launchConfig,
  }

  return { ...definition, description: missionDescription(definition) }
}

function buildMissionCatalog() {
  let catalogIndex = 0

  return MISSION_TIERS.flatMap((tier, tierIndex) =>
    MISSION_FAMILIES.flatMap((family, familyIndex) =>
      CONTEXT_MODE_BUCKETS.flatMap((bucket, bucketIndex) =>
        Array.from({ length: FAMILY_DISTRIBUTION[family][bucketIndex] }, (_, itemIndex) => {
          const definition = buildMissionDefinition({
            catalogIndex,
            tier,
            tierIndex,
            family,
            familyIndex,
            bucketIndex,
            itemIndex,
            ...bucket,
          })
          catalogIndex += 1
          return definition
        }),
      ),
    ),
  )
}

export const MISSION_CATALOG: MissionDefinition[] = buildMissionCatalog()

const MISSION_BY_KEY = new Map(MISSION_CATALOG.map((mission) => [mission.key, mission]))

function stableHash(value: string) {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function samePrimaryConfiguration(left: MissionDefinition, right: MissionDefinition) {
  if (left.family === 'diversity' || right.family === 'diversity') {
    return false
  }

  return left.requirements.playContext === right.requirements.playContext
    && left.requirements.challengeMode === right.requirements.challengeMode
    && left.requirements.level === right.requirements.level
    && left.requirements.game === right.requirements.game
}

function rankedTierCandidates(playerId: string, day: string, tier: MissionTier) {
  return MISSION_CATALOG
    .filter((mission) => mission.tier === tier)
    .map((mission) => ({ mission, rank: stableHash(`${playerId}:${day}:${tier}:${mission.key}`) }))
    .sort((left, right) => left.rank - right.rank || left.mission.key.localeCompare(right.mission.key))
    .map(({ mission }) => mission)
}

export function selectDailyMissions(playerId: string, day: string) {
  const selected: MissionDefinition[] = []

  for (const tier of MISSION_TIERS) {
    const candidates = rankedTierCandidates(playerId, day, tier)
    const matching = candidates.find((candidate) =>
      !selected.some((mission) => mission.family === candidate.family)
      && !(candidate.requirements.playContext === 'multiplayer'
        && selected.some((mission) => mission.requirements.playContext === 'multiplayer'))
      && !selected.some((mission) => samePrimaryConfiguration(mission, candidate)),
    )

    if (!matching) {
      throw new Error(`Impossible de sélectionner une mission quotidienne ${tier}.`)
    }

    selected.push(matching)
  }

  return selected
}

function matchesMissionSession(session: MissionSessionFact, definition: MissionDefinition) {
  const requirements = definition.requirements

  if (
    session.playContext !== requirements.playContext
    || session.challengeMode !== requirements.challengeMode
    || session.level !== requirements.level
    || (requirements.game && session.game !== requirements.game)
  ) {
    return false
  }

  if (requirements.diversityKind === 'configurations') {
    return requirements.recognizedConfigurationKeys.includes(sessionConfigurationKey(session))
  }

  if (requirements.challengeMode === 'sprint') {
    return session.configuredDurationSeconds !== null
      && session.configuredDurationSeconds >= (requirements.minSprintDurationSeconds ?? 0)
  }

  return session.configuredQuestionCount !== null
    && session.configuredQuestionSeconds !== null
    && session.configuredQuestionCount >= (requirements.minTempoQuestionCount ?? 0)
    && session.configuredQuestionSeconds <= (requirements.maxTempoQuestionSeconds ?? Number.POSITIVE_INFINITY)
}

function sessionConfigurationKey(session: MissionSessionFact) {
  if (session.challengeMode === 'sprint' && session.configuredDurationSeconds !== null) {
    return sprintConfigurationKey(session.configuredDurationSeconds)
  }

  if (
    session.challengeMode === 'tempo'
    && session.configuredQuestionCount !== null
    && session.configuredQuestionSeconds !== null
  ) {
    return tempoConfigurationKey(session.configuredQuestionCount, session.configuredQuestionSeconds)
  }

  return 'unknown'
}

function exactAccuracy(session: MissionSessionFact) {
  return session.totalQuestions > 0 ? (session.correctAnswers * 100) / session.totalQuestions : 0
}

export function missionCurrentValue(definition: MissionDefinition, sessions: MissionSessionFact[]) {
  const matchingSessions = sessions.filter((session) => matchesMissionSession(session, definition))

  switch (definition.family) {
    case 'sessions':
      return matchingSessions.length
    case 'valid_answers':
      return matchingSessions.reduce((sum, session) => sum + session.validAnswers, 0)
    case 'correct_answers':
      return matchingSessions.reduce((sum, session) => sum + session.correctAnswers, 0)
    case 'accuracy': {
      const accuracies = matchingSessions
        .filter((session) => session.validAnswers >= definition.minimumValidAnswers)
        .map(exactAccuracy)
      return accuracies.length ? Math.round(Math.max(...accuracies) * 10) / 10 : 0
    }
    case 'streak':
      return matchingSessions.reduce((best, session) => Math.max(best, session.bestStreak), 0)
    case 'diversity':
      if (definition.requirements.diversityKind === 'configurations') {
        return new Set(matchingSessions.map(sessionConfigurationKey)).size
      }
      return new Set(matchingSessions.map((session) => session.game)).size
  }
}

function clampProgress(current: number, target: number) {
  if (target <= 0) return 100
  return Math.max(0, Math.min(100, Math.round((current / target) * 100)))
}

export function buildMissionStates(
  definitions: MissionDefinition[],
  sessions: MissionSessionFact[],
  completions: MissionCompletionRef[],
  day: string,
): MissionState[] {
  const completedByScope = new Map(completions.map((completion) => [`${completion.missionKey}:${completion.scopeKey}`, completion]))

  return definitions.map((definition) => {
    const completion = completedByScope.get(`${definition.key}:${day}`)
    const rawCurrent = Math.max(0, missionCurrentValue(definition, sessions))
    const current = Math.min(definition.target, rawCurrent)
    const completed = current >= definition.target || Boolean(completion)

    return {
      ...definition,
      scopeKey: day,
      current: completed ? definition.target : current,
      progress: completed ? 100 : clampProgress(current, definition.target),
      completed,
      claimed: Boolean(completion),
      completedAt: completion?.completedAt ? new Date(completion.completedAt).toISOString() : null,
    }
  })
}

export function missionDefinitionFromSnapshot(snapshot: unknown, missionKey?: string) {
  if (
    typeof snapshot === 'object'
    && snapshot !== null
    && 'version' in snapshot
    && typeof snapshot.version === 'number'
    && Number.isInteger(snapshot.version)
    && snapshot.version > 0
    && 'key' in snapshot
    && typeof snapshot.key === 'string'
    && 'requirements' in snapshot
    && typeof snapshot.requirements === 'object'
    && snapshot.requirements !== null
    && 'launchConfig' in snapshot
    && typeof snapshot.launchConfig === 'object'
    && snapshot.launchConfig !== null
  ) {
    return snapshot as MissionDefinition
  }

  return missionKey ? MISSION_BY_KEY.get(missionKey) ?? null : null
}

export function missionCatalogDefinition(missionKey: string) {
  return MISSION_BY_KEY.get(missionKey) ?? null
}

export function missionContextLabel(definition: MissionDefinition) {
  return `${contextLabel(definition.requirements.playContext)} · ${definition.requirements.challengeMode === 'sprint' ? 'Sprint' : 'Tempo'}`
}
