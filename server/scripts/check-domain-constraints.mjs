import { config as loadEnv } from 'dotenv'
import pg from 'pg'

const { Client } = pg

loadEnv({ path: '.env.local', override: false })
loadEnv({ path: '.env', override: false })

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL

if (!databaseUrl) {
  console.error('DATABASE_URL ou DIRECT_URL est requis pour verifier les contraintes domaine.')
  process.exit(1)
}

const checks = [
  ['players.presence_status', "SELECT presence_status AS value, count(*)::int AS count FROM players WHERE presence_status NOT IN ('online', 'away', 'offline') GROUP BY presence_status"],
  ['notifications.type', "SELECT type AS value, count(*)::int AS count FROM notifications WHERE type NOT IN ('friend_request_received', 'friend_request_accepted', 'match_invite_received', 'match_invite_accepted', 'match_invite_declined') GROUP BY type"],
  ['notifications.status', "SELECT status AS value, count(*)::int AS count FROM notifications WHERE status NOT IN ('active', 'dismissed') GROUP BY status"],
  ['friend_requests.status', "SELECT status AS value, count(*)::int AS count FROM friend_requests WHERE status NOT IN ('pending', 'accepted', 'declined', 'cancelled') GROUP BY status"],
  ['matches.type', "SELECT type AS value, count(*)::int AS count FROM matches WHERE type NOT IN ('challenge') GROUP BY type"],
  ['matches.challenge_mode', "SELECT challenge_mode AS value, count(*)::int AS count FROM matches WHERE challenge_mode IS NOT NULL AND challenge_mode NOT IN ('sprint', 'tempo') GROUP BY challenge_mode"],
  ['matches.status', "SELECT status AS value, count(*)::int AS count FROM matches WHERE status NOT IN ('pending', 'accepted', 'ready', 'in_progress', 'completed', 'cancelled', 'expired') GROUP BY status"],
  ['matches.game', "SELECT game AS value, count(*)::int AS count FROM matches WHERE game IS NOT NULL AND game NOT IN ('addition', 'soustraction', 'multiplication', 'division', 'mixte') GROUP BY game"],
  ['matches.level', "SELECT level AS value, count(*)::int AS count FROM matches WHERE level IS NOT NULL AND level NOT IN ('debutant', 'intermediaire', 'avance', 'expert') GROUP BY level"],
  ['matches.practice_skill', "SELECT practice_skill AS value, count(*)::int AS count FROM matches WHERE practice_skill IS NOT NULL AND practice_skill NOT IN ('addition', 'soustraction', 'multiplication', 'division', 'retenues', 'emprunts', 'tables', 'calcul_rapide', 'mixte') GROUP BY practice_skill"],
  ['match_participants.status', "SELECT status AS value, count(*)::int AS count FROM match_participants WHERE status NOT IN ('invited', 'accepted', 'declined', 'ready', 'playing', 'submitting', 'completed', 'disconnected') GROUP BY status"],
  ['match_participants.preferred_challenge_mode', "SELECT preferred_challenge_mode AS value, count(*)::int AS count FROM match_participants WHERE preferred_challenge_mode IS NOT NULL AND preferred_challenge_mode NOT IN ('sprint', 'tempo') GROUP BY preferred_challenge_mode"],
  ['match_participants.preferred_game', "SELECT preferred_game AS value, count(*)::int AS count FROM match_participants WHERE preferred_game IS NOT NULL AND preferred_game NOT IN ('addition', 'soustraction', 'multiplication', 'division', 'mixte') GROUP BY preferred_game"],
  ['match_participants.preferred_level', "SELECT preferred_level AS value, count(*)::int AS count FROM match_participants WHERE preferred_level IS NOT NULL AND preferred_level NOT IN ('debutant', 'intermediaire', 'avance', 'expert') GROUP BY preferred_level"],
  ['game_sessions.game', "SELECT game AS value, count(*)::int AS count FROM game_sessions WHERE game NOT IN ('addition', 'soustraction', 'multiplication', 'division', 'mixte') GROUP BY game"],
  ['game_sessions.level', "SELECT level AS value, count(*)::int AS count FROM game_sessions WHERE level NOT IN ('debutant', 'intermediaire', 'avance', 'expert') GROUP BY level"],
  ['game_sessions.practice_skill', "SELECT practice_skill AS value, count(*)::int AS count FROM game_sessions WHERE practice_skill IS NOT NULL AND practice_skill NOT IN ('addition', 'soustraction', 'multiplication', 'division', 'retenues', 'emprunts', 'tables', 'calcul_rapide', 'mixte') GROUP BY practice_skill"],
  ['answers.game', "SELECT game AS value, count(*)::int AS count FROM answers WHERE game NOT IN ('addition', 'soustraction', 'multiplication', 'division', 'mixte') GROUP BY game"],
  ['answers.level', "SELECT level AS value, count(*)::int AS count FROM answers WHERE level NOT IN ('debutant', 'intermediaire', 'avance', 'expert') GROUP BY level"],
  ['answers.skill', "SELECT skill AS value, count(*)::int AS count FROM answers WHERE skill NOT IN ('addition', 'soustraction', 'multiplication', 'division', 'retenues', 'emprunts', 'tables', 'calcul_rapide', 'mixte') GROUP BY skill"],
  ['match_question_answers.skill', "SELECT skill AS value, count(*)::int AS count FROM match_question_answers WHERE skill NOT IN ('addition', 'soustraction', 'multiplication', 'division', 'retenues', 'emprunts', 'tables', 'calcul_rapide', 'mixte') GROUP BY skill"],
]

const client = new Client({ connectionString: databaseUrl })
const invalidRows = []

try {
  await client.connect()

  for (const [field, sql] of checks) {
    try {
      const result = await client.query(sql)
      for (const row of result.rows) {
        invalidRows.push({ field, value: row.value, count: row.count })
      }
    } catch (error) {
      if (error?.code !== '42P01') {
        throw error
      }
    }
  }
} finally {
  await client.end().catch(() => undefined)
}

if (invalidRows.length) {
  console.error(JSON.stringify({ ok: false, invalidRows }, null, 2))
  process.exit(1)
}

console.log(JSON.stringify({ ok: true, invalidRows: [] }))
