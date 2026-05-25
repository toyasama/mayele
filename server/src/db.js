const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const configuredDatabasePath = process.env.DATABASE_URL || path.join(__dirname, '..', 'data', 'mayele-maths.db')
const databasePath = path.isAbsolute(configuredDatabasePath)
  ? configuredDatabasePath
  : path.resolve(__dirname, '..', configuredDatabasePath)
const dataDirectory = path.dirname(databasePath)

fs.mkdirSync(dataDirectory, { recursive: true })

const db = new Database(databasePath)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`)

const requiredSessionColumns = new Set([
  'id',
  'user_id',
  'game',
  'level',
  'score',
  'points',
  'correct_answers',
  'total_questions',
  'duration_seconds',
  'best_streak',
  'played_at',
])
const sessionColumns = db.prepare("PRAGMA table_info('sessions')").all().map((column) => column.name)
const hasLegacySessionSchema =
  sessionColumns.length > 0 && sessionColumns.some((column) => !requiredSessionColumns.has(column))
const missesTargetColumns =
  sessionColumns.length > 0 && [...requiredSessionColumns].some((column) => !sessionColumns.includes(column))

if (hasLegacySessionSchema || missesTargetColumns) {
  db.exec(`
    DROP TABLE IF EXISTS progress;
    DROP TABLE IF EXISTS sessions;
  `)
} else {
  db.exec('DROP TABLE IF EXISTS progress;')
}

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    game TEXT NOT NULL,
    level TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    points INTEGER NOT NULL DEFAULT 0,
    correct_answers INTEGER NOT NULL DEFAULT 0,
    total_questions INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    played_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_played_at
    ON sessions(user_id, played_at DESC);

  CREATE INDEX IF NOT EXISTS idx_sessions_user_mode
    ON sessions(user_id, game, level);
`)

module.exports = db
