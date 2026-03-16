import { Pool } from 'pg'

async function main() {
  const rawUrl = process.env.DATABASE_URL || ''
  const dbUrl = new URL(rawUrl)

  const pool = new Pool({
    host: dbUrl.hostname,
    port: parseInt(dbUrl.port || '5432'),
    database: dbUrl.pathname.slice(1),
    user: dbUrl.username,
    password: dbUrl.password,
    ssl: { rejectUnauthorized: false },
  })

  const client = await pool.connect()
  try {
    // Create a dedicated schema owned by the current user.
    // This avoids PostgreSQL 15's restriction that revoked CREATE on the public schema.
    await client.query('CREATE SCHEMA IF NOT EXISTS app')
    await client.query('SET search_path TO app')
    console.log('Using schema: app')

    await client.query(`
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        config JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        host_player_id TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP,
        game_state JSONB
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id),
        display_name TEXT NOT NULL,
        seat_index INTEGER NOT NULL,
        token TEXT NOT NULL,
        chips_brought_in INTEGER NOT NULL DEFAULT 0,
        chips_carried_out INTEGER,
        joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
        left_at TIMESTAMP
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS hands (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id),
        hand_number INTEGER NOT NULL,
        dealer_seat_index INTEGER NOT NULL,
        community_cards JSONB NOT NULL DEFAULT '[]',
        pot_total INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS hand_actions (
        id SERIAL PRIMARY KEY,
        hand_id TEXT NOT NULL REFERENCES hands(id),
        player_id TEXT NOT NULL REFERENCES players(id),
        phase TEXT NOT NULL,
        action_type TEXT NOT NULL,
        amount INTEGER,
        ordering INTEGER NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS hand_results (
        id SERIAL PRIMARY KEY,
        hand_id TEXT NOT NULL REFERENCES hands(id),
        player_id TEXT NOT NULL REFERENCES players(id),
        hole_cards JSONB,
        hand_rank INTEGER,
        hand_description TEXT,
        winnings INTEGER NOT NULL DEFAULT 0
      )
    `)

    console.log('Migration complete')
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
