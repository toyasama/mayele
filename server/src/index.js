const express = require('express')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const db = require('./db')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 4000
const JWT_SECRET = process.env.JWT_SECRET || 'mayele-local-dev-secret'

app.use(cors())
app.use(express.json())

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
    next()
  } catch {
    return res.status(401).json({ message: 'Session invalide ou expirée.' })
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.post('/api/auth/register', async (req, res) => {
  const name = String(req.body.name ?? '').trim()
  const email = String(req.body.email ?? '').trim().toLowerCase()
  const password = String(req.body.password ?? '')

  if (!name || !email || password.length < 6) {
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

  res.status(201).json({
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

  res.json({
    token: createToken(user.id),
    user: mapUser(user),
  })
})

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

app.get('/api/dashboard', requireAuth, (req, res) => {
  const progressByGame = db
    .prepare(
      `SELECT
        game,
        attempts,
        best_score AS bestScore,
        ROUND(CASE WHEN attempts = 0 THEN 0 ELSE total_points * 1.0 / attempts END, 1) AS averageScore,
        last_played_at AS lastPlayedAt
      FROM progress
      WHERE user_id = ?
      ORDER BY best_score DESC, attempts DESC`,
    )
    .all(req.user.id)

  const recentSessions = db
    .prepare(
      `SELECT
        id,
        game,
        score,
        correct_answers AS correctAnswers,
        total_questions AS totalQuestions,
        duration_seconds AS durationSeconds,
        played_at AS playedAt
      FROM sessions
      WHERE user_id = ?
      ORDER BY played_at DESC
      LIMIT 8`,
    )
    .all(req.user.id)

  const summary = db
    .prepare(
      `SELECT
        COUNT(*) AS totalGames,
        COALESCE(MAX(score), 0) AS bestScore,
        COALESCE(SUM(score), 0) AS totalPoints
      FROM sessions
      WHERE user_id = ?`,
    )
    .get(req.user.id)

  res.json({
    summary: {
      totalGames: summary.totalGames,
      bestScore: summary.bestScore,
      totalPoints: summary.totalPoints,
      masteredTopics: progressByGame.filter((item) => item.bestScore >= 80).length,
    },
    progressByGame,
    recentSessions,
  })
})

app.post('/api/sessions', requireAuth, (req, res) => {
  const validGames = new Set(['addition', 'soustraction', 'multiplication'])
  const game = validGames.has(req.body.game) ? req.body.game : 'addition'
  const score = Math.max(0, Math.min(100, Number(req.body.score) || 0))
  const correctAnswers = Math.max(0, Number(req.body.correctAnswers) || 0)
  const totalQuestions = Math.max(1, Number(req.body.totalQuestions) || 10)
  const durationSeconds = Math.max(1, Number(req.body.durationSeconds) || 1)

  db.prepare(
    `INSERT INTO sessions (user_id, game, score, correct_answers, total_questions, duration_seconds)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(req.user.id, game, score, correctAnswers, totalQuestions, durationSeconds)

  const existingProgress = db
    .prepare('SELECT id, attempts, best_score, total_points FROM progress WHERE user_id = ? AND game = ?')
    .get(req.user.id, game)

  if (existingProgress) {
    db.prepare(
      `UPDATE progress
       SET attempts = ?,
           best_score = ?,
           total_points = ?,
           last_played_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(
      existingProgress.attempts + 1,
      Math.max(existingProgress.best_score, score),
      existingProgress.total_points + score,
      existingProgress.id,
    )
  } else {
    db.prepare(
      `INSERT INTO progress (user_id, game, attempts, best_score, total_points, last_played_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    ).run(req.user.id, game, 1, score, score)
  }

  res.status(201).json({ message: 'Session enregistrée.' })
})

// Servir les fichiers statiques du frontend en production
app.use(express.static(path.join(__dirname, '../../client/dist')))

// Fallback pour React Router (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'))
})

app.listen(PORT, () => {
  console.log(`Mayele API disponible sur http://localhost:${PORT}`)
})
