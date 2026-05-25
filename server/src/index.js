const express = require('express')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const path = require('node:path')
const db = require('./db')

const app = express()
const PORT = process.env.PORT || 4000
const JWT_SECRET = process.env.JWT_SECRET || 'mayele-local-dev-secret'
const isProduction = process.env.NODE_ENV === 'production'
const allowedOrigins = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const DAILY_GOAL = 3
const VALID_GAMES = new Set(['addition', 'soustraction', 'multiplication', 'division', 'mixte'])
const VALID_LEVELS = new Set(['debutant', 'intermediaire', 'avance', 'expert'])
const VALID_SKILLS = new Set([
  'addition',
  'soustraction',
  'multiplication',
  'division',
  'retenues',
  'emprunts',
  'tables',
  'calcul_rapide',
  'mixte',
])

const ACHIEVEMENTS = {
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
  points_100: {
    label: '100 points',
    description: 'Vous avez marqué au moins 100 points en un sprint.',
  },
  daily_goal: {
    label: 'Objectif du jour',
    description: 'Vous avez terminé 3 sprints aujourd’hui.',
  },
}

if (isProduction && JWT_SECRET === 'mayele-local-dev-secret') {
  throw new Error('JWT_SECRET doit être défini en production.')
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true)
        return
      }

      callback(new Error('Origin non autorisée.'))
    },
  }),
)
app.use(express.json({ limit: '96kb' }))

function mapUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
  }
}

function createToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' })
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Connexion requise.' })
  }

  const token = authHeader.slice('Bearer '.length)

  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const user = db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(payload.userId)

    if (!user) {
      return res.status(401).json({ message: 'Utilisateur introuvable.' })
    }

    req.user = mapUser(user)
    return next()
  } catch {
    return res.status(401).json({ message: 'Session invalide ou expirée.' })
  }
}

function parseInteger(value) {
  if (!Number.isInteger(value)) {
    return null
  }

  return value
}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function calculateAccuracy(correctAnswers, totalQuestions) {
  if (totalQuestions === 0) {
    return 0
  }

  return Math.round((correctAnswers / totalQuestions) * 100)
}

function validateAnswer(rawAnswer, sessionGame, sessionLevel) {
  const prompt = String(rawAnswer.prompt ?? '').trim()
  const correctAnswer = parseInteger(rawAnswer.correctAnswer)
  const userAnswer = parseInteger(rawAnswer.userAnswer)
  const responseTimeMs = parseInteger(rawAnswer.responseTimeMs)
  const game = typeof rawAnswer.game === 'string' && VALID_GAMES.has(rawAnswer.game) ? rawAnswer.game : sessionGame
  const level = typeof rawAnswer.level === 'string' && VALID_LEVELS.has(rawAnswer.level) ? rawAnswer.level : sessionLevel
  const skill = typeof rawAnswer.skill === 'string' && VALID_SKILLS.has(rawAnswer.skill) ? rawAnswer.skill : null

  if (!prompt || prompt.length > 80) {
    return { error: 'Question invalide.' }
  }

  if (correctAnswer === null || userAnswer === null) {
    return { error: 'Réponse invalide.' }
  }

  if (responseTimeMs === null || responseTimeMs < 0 || responseTimeMs > 600000) {
    return { error: 'Temps de réponse invalide.' }
  }

  if (!skill) {
    return { error: 'Compétence invalide.' }
  }

  return {
    value: {
      prompt,
      correctAnswer,
      userAnswer,
      responseTimeMs,
      game,
      level,
      skill,
      isCorrect: userAnswer === correctAnswer,
    },
  }
}

function validateSessionPayload(body) {
  const game = typeof body.game === 'string' && VALID_GAMES.has(body.game) ? body.game : null
  const level = typeof body.level === 'string' && VALID_LEVELS.has(body.level) ? body.level : null
  const practiceSkill =
    typeof body.practiceSkill === 'string' && VALID_SKILLS.has(body.practiceSkill) ? body.practiceSkill : null
  const totalQuestions = parseInteger(body.totalQuestions)
  const durationSeconds = parseInteger(body.durationSeconds)
  const bestStreak = parseInteger(body.bestStreak)
  const points = parseInteger(body.points)
  const answers = Array.isArray(body.answers) ? body.answers : null

  if (!game || !level) {
    return { error: 'Mode ou niveau invalide.' }
  }

  if (!totalQuestions || totalQuestions < 1 || totalQuestions > 500) {
    return { error: 'Nombre de questions invalide.' }
  }

  if (!durationSeconds || durationSeconds < 1 || durationSeconds > 3600) {
    return { error: 'Durée de session invalide.' }
  }

  if (bestStreak === null || bestStreak < 0 || bestStreak > totalQuestions) {
    return { error: 'Meilleure série invalide.' }
  }

  if (points === null || points < 0 || points > 100000) {
    return { error: 'Score de points invalide.' }
  }

  if (!answers || answers.length !== totalQuestions) {
    return { error: 'Détail des réponses requis.' }
  }

  const parsedAnswers = []
  for (const answer of answers) {
    const result = validateAnswer(answer, game, level)

    if (result.error) {
      return result
    }

    parsedAnswers.push(result.value)
  }

  const correctAnswers = parsedAnswers.filter((answer) => answer.isCorrect).length

  return {
    value: {
      game,
      level,
      practiceSkill,
      score: calculateAccuracy(correctAnswers, parsedAnswers.length),
      points,
      correctAnswers,
      totalQuestions: parsedAnswers.length,
      durationSeconds,
      bestStreak,
      answers: parsedAnswers,
    },
  }
}

function insertAchievement(userId, key) {
  const achievement = ACHIEVEMENTS[key]

  if (!achievement) {
    return null
  }

  const result = db
    .prepare(
      `INSERT OR IGNORE INTO achievements (user_id, achievement_key, label, description)
       VALUES (?, ?, ?, ?)`,
    )
    .run(userId, key, achievement.label, achievement.description)

  return result.changes ? { key, label: achievement.label } : null
}

function awardAchievements(userId, session, dailySessionsCount) {
  const earned = []
  const totalSessions = db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(userId).count

  if (totalSessions === 1) {
    earned.push(insertAchievement(userId, 'first_sprint'))
  }

  if (session.score >= 80) {
    earned.push(insertAchievement(userId, 'accuracy_80'))
  }

  if (session.score === 100) {
    earned.push(insertAchievement(userId, 'perfect_sprint'))
  }

  if (session.bestStreak >= 5) {
    earned.push(insertAchievement(userId, 'streak_5'))
  }

  if (session.points >= 100) {
    earned.push(insertAchievement(userId, 'points_100'))
  }

  if (dailySessionsCount >= DAILY_GOAL) {
    earned.push(insertAchievement(userId, 'daily_goal'))
  }

  return earned.filter(Boolean)
}

function buildWeakSkills(userId) {
  return db
    .prepare(
      `SELECT
        skill,
        COUNT(*) AS attempts,
        SUM(is_correct) AS correctAnswers,
        ROUND(SUM(is_correct) * 100.0 / COUNT(*)) AS accuracy
      FROM answers
      WHERE user_id = ?
      GROUP BY skill
      HAVING attempts >= 3
      ORDER BY accuracy ASC, attempts DESC
      LIMIT 4`,
    )
    .all(userId)
}

function buildPracticePlan(userId) {
  const weakSkills = buildWeakSkills(userId)
  const recommended = weakSkills.find((item) => item.accuracy < 80)
  const level = db
    .prepare(
      `SELECT level
       FROM sessions
       WHERE user_id = ?
       ORDER BY played_at DESC
       LIMIT 1`,
    )
    .get(userId)

  if (!recommended) {
    return {
      recommendedSkill: null,
      recommendedLevel: level?.level ?? 'debutant',
      message: 'Aucune faiblesse fiable détectée pour le moment. Continuez avec quelques sprints mixtes.',
    }
  }

  return {
    recommendedSkill: recommended.skill,
    recommendedLevel: level?.level ?? 'debutant',
    message: `Priorité: retravailler cette compétence, actuellement à ${recommended.accuracy}% de réussite.`,
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.post('/api/auth/register', async (req, res) => {
  const name = String(req.body.name ?? '').trim()
  const email = String(req.body.email ?? '').trim().toLowerCase()
  const password = String(req.body.password ?? '')

  if (!name || name.length < 2 || !email || password.length < 6) {
    return res.status(400).json({ message: 'Nom, email et mot de passe valide requis.' })
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (existingUser) {
    return res.status(409).json({ message: 'Un compte existe déjà avec cet email.' })
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const result = db
    .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name, email, passwordHash)

  const user = db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(result.lastInsertRowid)

  return res.status(201).json({
    token: createToken(user.id),
    user: mapUser(user),
  })
})

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email ?? '').trim().toLowerCase()
  const password = String(req.body.password ?? '')

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)

  if (!user) {
    return res.status(401).json({ message: 'Email ou mot de passe incorrect.' })
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash)

  if (!passwordMatches) {
    return res.status(401).json({ message: 'Email ou mot de passe incorrect.' })
  }

  return res.json({
    token: createToken(user.id),
    user: mapUser(user),
  })
})

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

app.get('/api/practice-plan', requireAuth, (req, res) => {
  res.json({ practicePlan: buildPracticePlan(req.user.id) })
})

app.get('/api/dashboard', requireAuth, (req, res) => {
  const day = todayKey()
  const summary = db
    .prepare(
      `SELECT
        COUNT(*) AS totalSessions,
        COALESCE(MAX(score), 0) AS bestScore,
        COALESCE(SUM(points), 0) AS totalPoints,
        COALESCE(ROUND(AVG(CASE WHEN total_questions = 0 THEN 0 ELSE correct_answers * 100.0 / total_questions END)), 0) AS averageAccuracy,
        COALESCE(MAX(best_streak), 0) AS bestStreak,
        MAX(played_at) AS lastPlayedAt
      FROM sessions
      WHERE user_id = ?`,
    )
    .get(req.user.id)

  const todayStats = db
    .prepare('SELECT sessions_count AS todaySessions FROM daily_stats WHERE user_id = ? AND day = ?')
    .get(req.user.id, day)

  const favoriteGame = db
    .prepare(
      `SELECT game
      FROM sessions
      WHERE user_id = ?
      GROUP BY game
      ORDER BY COUNT(*) DESC, MAX(played_at) DESC
      LIMIT 1`,
    )
    .get(req.user.id)

  const progressByMode = db
    .prepare(
      `SELECT
        game,
        level,
        COUNT(*) AS attempts,
        COALESCE(MAX(score), 0) AS bestScore,
        COALESCE(ROUND(AVG(score)), 0) AS averageScore,
        COALESCE(ROUND(AVG(CASE WHEN total_questions = 0 THEN 0 ELSE correct_answers * 100.0 / total_questions END)), 0) AS averageAccuracy,
        COALESCE(MAX(best_streak), 0) AS bestStreak,
        MAX(played_at) AS lastPlayedAt
      FROM sessions
      WHERE user_id = ?
      GROUP BY game, level
      ORDER BY bestScore DESC, attempts DESC, lastPlayedAt DESC`,
    )
    .all(req.user.id)

  const recentSessions = db
    .prepare(
      `SELECT
        id,
        game,
        level,
        practice_skill AS practiceSkill,
        score,
        points,
        correct_answers AS correctAnswers,
        total_questions AS totalQuestions,
        duration_seconds AS durationSeconds,
        best_streak AS bestStreak,
        played_at AS playedAt
      FROM sessions
      WHERE user_id = ?
      ORDER BY played_at DESC
      LIMIT 10`,
    )
    .all(req.user.id)

  const achievements = db
    .prepare(
      `SELECT
        achievement_key AS key,
        label,
        description,
        earned_at AS earnedAt
      FROM achievements
      WHERE user_id = ?
      ORDER BY earned_at DESC
      LIMIT 8`,
    )
    .all(req.user.id)

  return res.json({
    summary: {
      totalSessions: summary.totalSessions,
      bestScore: summary.bestScore,
      totalPoints: summary.totalPoints,
      averageAccuracy: summary.averageAccuracy,
      bestStreak: summary.bestStreak,
      lastPlayedAt: summary.lastPlayedAt,
      favoriteGame: favoriteGame?.game ?? null,
      todaySessions: todayStats?.todaySessions ?? 0,
      dailyGoal: DAILY_GOAL,
    },
    practicePlan: buildPracticePlan(req.user.id),
    weakSkills: buildWeakSkills(req.user.id),
    achievements,
    progressByMode,
    recentSessions,
  })
})

app.post('/api/sessions', requireAuth, (req, res) => {
  const result = validateSessionPayload(req.body)

  if (result.error) {
    return res.status(400).json({ message: result.error })
  }

  const session = result.value
  const day = todayKey()

  const save = db.transaction(() => {
    const insertSession = db
      .prepare(
        `INSERT INTO sessions (
          user_id,
          game,
          level,
          practice_skill,
          score,
          points,
          correct_answers,
          total_questions,
          duration_seconds,
          best_streak
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        req.user.id,
        session.game,
        session.level,
        session.practiceSkill,
        session.score,
        session.points,
        session.correctAnswers,
        session.totalQuestions,
        session.durationSeconds,
        session.bestStreak,
      )

    const sessionId = insertSession.lastInsertRowid
    const insertAnswer = db.prepare(
      `INSERT INTO answers (
        session_id,
        user_id,
        game,
        level,
        skill,
        prompt,
        correct_answer,
        user_answer,
        response_time_ms,
        is_correct
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )

    session.answers.forEach((answer) => {
      insertAnswer.run(
        sessionId,
        req.user.id,
        answer.game,
        answer.level,
        answer.skill,
        answer.prompt,
        answer.correctAnswer,
        answer.userAnswer,
        answer.responseTimeMs,
        answer.isCorrect ? 1 : 0,
      )
    })

    db.prepare(
      `INSERT INTO daily_stats (user_id, day, sessions_count, points, correct_answers, total_questions)
       VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET
         sessions_count = sessions_count + 1,
         points = points + excluded.points,
         correct_answers = correct_answers + excluded.correct_answers,
         total_questions = total_questions + excluded.total_questions`,
    ).run(req.user.id, day, session.points, session.correctAnswers, session.totalQuestions)

    const dailySessionsCount = db
      .prepare('SELECT sessions_count FROM daily_stats WHERE user_id = ? AND day = ?')
      .get(req.user.id, day).sessions_count

    return awardAchievements(req.user.id, session, dailySessionsCount)
  })

  const earnedAchievements = save()

  return res.status(201).json({ message: 'Session enregistrée.', earnedAchievements })
})

const clientDistPath = path.join(__dirname, '../../client/dist')
app.use(express.static(clientDistPath))

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'))
})

app.use((err, _req, res, _next) => {
  if (err.message === 'Origin non autorisée.') {
    return res.status(403).json({ message: err.message })
  }

  console.error(err)
  return res.status(500).json({ message: 'Erreur serveur.' })
})

app.listen(PORT, () => {
  console.log(`Mayele API disponible sur http://localhost:${PORT}`)
})
