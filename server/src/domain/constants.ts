export const DAILY_GOAL = 3

export const VALID_GAMES = ['addition', 'soustraction', 'multiplication', 'division', 'mixte'] as const
export const VALID_LEVELS = ['debutant', 'intermediaire', 'avance', 'expert'] as const
export const VALID_SKILLS = [
  'addition',
  'soustraction',
  'multiplication',
  'division',
  'retenues',
  'emprunts',
  'tables',
  'calcul_rapide',
  'mixte',
] as const

export type GameType = (typeof VALID_GAMES)[number]
export type GameLevel = (typeof VALID_LEVELS)[number]
export type SkillTag = (typeof VALID_SKILLS)[number]

export const ACHIEVEMENTS = {
  first_sprint: {
    label: 'Premier sprint',
    description: 'Vous avez enregistré votre première session.',
  },
  accuracy_80: {
    label: 'Précision 80%',
    description: 'Vous avez atteint au moins 80% de réussite.',
  },
  perfect_sprint: {
    label: 'Sans faute',
    description: 'Vous avez terminé un sprint avec 100% de réussite.',
  },
  streak_5: {
    label: 'Série x5',
    description: 'Vous avez enchaîné 5 bonnes réponses.',
  },
  xp_250: {
    label: '250 XP',
    description: 'Vous avez gagné au moins 250 XP en un sprint.',
  },
  daily_goal: {
    label: 'Objectif du jour',
    description: 'Vous avez terminé 3 sprints aujourd’hui.',
  },
} as const
