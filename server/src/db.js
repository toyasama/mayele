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

function tableColumns(tableName) {
  return db.prepare(`PRAGMA table_info('${tableName}')`).all().map((column) => column.name)
}

function tableMatches(tableName, requiredColumns) {
  const columns = tableColumns(tableName)

  if (columns.length === 0) {
    return false
  }

  return requiredColumns.every((column) => columns.includes(column))
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`)

const schemaIsCurrent =
  tableMatches('sessions', [
    'id',
    'user_id',
    'game',
    'level',
    'practice_skill',
    'score',
    'points',
    'correct_answers',
    'total_questions',
    'duration_seconds',
    'best_streak',
    'played_at',
  ]) &&
  tableMatches('answers', [
    'id',
    'session_id',
    'user_id',
    'game',
    'level',
    'skill',
    'prompt',
    'correct_answer',
    'user_answer',
    'response_time_ms',
    'is_correct',
    'answered_at',
  ]) &&
  tableMatches('achievements', ['id', 'user_id', 'achievement_key', 'label', 'description', 'earned_at']) &&
  tableMatches('daily_stats', ['id', 'user_id', 'day', 'sessions_count', 'points', 'correct_answers', 'total_questions'])

if (!schemaIsCurrent) {
  db.exec(`
    DROP TABLE IF EXISTS progress;
    DROP TABLE IF EXISTS answers;
    DROP TABLE IF EXISTS achievements;
    DROP TABLE IF EXISTS daily_stats;
    DROP TABLE IF EXISTS sessions;
  `)
}

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    game TEXT NOT NULL,
    level TEXT NOT NULL,
    practice_skill TEXT,
    score INTEGER NOT NULL DEFAULT 0,
    points INTEGER NOT NULL DEFAULT 0,
    correct_answers INTEGER NOT NULL DEFAULT 0,
    total_questions INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    played_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    game TEXT NOT NULL,
    level TEXT NOT NULL,
    skill TEXT NOT NULL,
    prompt TEXT NOT NULL,
    correct_answer INTEGER NOT NULL,
    user_answer INTEGER NOT NULL,
    response_time_ms INTEGER NOT NULL,
    is_correct INTEGER NOT NULL DEFAULT 0,
    answered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    achievement_key TEXT NOT NULL,
    label TEXT NOT NULL,
    description TEXT NOT NULL,
    earned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, achievement_key),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS daily_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    sessions_count INTEGER NOT NULL DEFAULT 0,
    points INTEGER NOT NULL DEFAULT 0,
    correct_answers INTEGER NOT NULL DEFAULT 0,
    total_questions INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, day),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_played_at
    ON sessions(user_id, played_at DESC);

  CREATE INDEX IF NOT EXISTS idx_sessions_user_mode
    ON sessions(user_id, game, level);

  CREATE INDEX IF NOT EXISTS idx_answers_user_skill
    ON answers(user_id, skill);

  CREATE INDEX IF NOT EXISTS idx_answers_session
    ON answers(session_id);
`)

module.exports = db
