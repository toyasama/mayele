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

const VALID_GAMES = new Set(['addition', 'soustraction', 'multiplication', 'mixte'])
const VALID_LEVELS = new Set(['debutant', 'intermediaire', 'avance', 'expert'])

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
app.use(express.json({ limit: '32kb' }))

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

function validateSessionPayload(body) {
  const game = typeof body.game === 'string' && VALID_GAMES.has(body.game) ? body.game : null
  const level = typeof body.level === 'string' && VALID_LEVELS.has(body.level) ? body.level : null
  const totalQuestions = parseInteger(body.totalQuestions)
  const correctAnswers = parseInteger(body.correctAnswers)
  const durationSeconds = parseInteger(body.durationSeconds)
  const bestStreak = parseInteger(body.bestStreak)
  const points = parseInteger(body.points)

  if (!game || !level) {
    return { error: 'Mode ou niveau invalide.' }
  }

  if (!totalQuestions || totalQuestions < 1 || totalQuestions > 500) {
    return { error: 'Nombre de questions invalide.' }
  }

  if (correctAnswers === null || correctAnswers < 0 || correctAnswers > totalQuestions) {
    return { error: 'Nombre de bonnes réponses invalide.' }
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

  return {
    value: {
      game,
      level,
      score: Math.round((correctAnswers / totalQuestions) * 100),
      points,
      correctAnswers,
      totalQuestions,
      durationSeconds,
      bestStreak,
    },
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

app.get('/api/dashboard', requireAuth, (req, res) => {
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

  return res.json({
    summary: {
      totalSessions: summary.totalSessions,
      bestScore: summary.bestScore,
      totalPoints: summary.totalPoints,
      averageAccuracy: summary.averageAccuracy,
      bestStreak: summary.bestStreak,
      lastPlayedAt: summary.lastPlayedAt,
      favoriteGame: favoriteGame?.game ?? null,
    },
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

  db.prepare(
    `INSERT INTO sessions (
      user_id,
      game,
      level,
      score,
      points,
      correct_answers,
      total_questions,
      duration_seconds,
      best_streak
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    req.user.id,
    session.game,
    session.level,
    session.score,
    session.points,
    session.correctAnswers,
    session.totalQuestions,
    session.durationSeconds,
    session.bestStreak,
  )

  return res.status(201).json({ message: 'Session enregistrée.' })
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
