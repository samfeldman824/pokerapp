import { Pool, type PoolClient } from 'pg'

const TABLES = [
  `CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    config JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    host_player_id TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP,
    game_state JSONB
  )`,
  `CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL REFERENCES games(id),
    display_name TEXT NOT NULL,
    seat_index INTEGER NOT NULL,
    token TEXT NOT NULL,
    chips_brought_in INTEGER NOT NULL DEFAULT 0,
    chips_carried_out INTEGER,
    joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
    left_at TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS hands (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL REFERENCES games(id),
    hand_number INTEGER NOT NULL,
    dealer_seat_index INTEGER NOT NULL,
    community_cards JSONB NOT NULL DEFAULT '[]',
    pot_total INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS hand_actions (
    id SERIAL PRIMARY KEY,
    hand_id TEXT NOT NULL REFERENCES hands(id),
    player_id TEXT NOT NULL REFERENCES players(id),
    phase TEXT NOT NULL,
    action_type TEXT NOT NULL,
    amount INTEGER,
    ordering INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS hand_results (
    id SERIAL PRIMARY KEY,
    hand_id TEXT NOT NULL REFERENCES hands(id),
    player_id TEXT NOT NULL REFERENCES players(id),
    hole_cards JSONB,
    hand_rank INTEGER,
    hand_description TEXT,
    winnings INTEGER NOT NULL DEFAULT 0
  )`,
]

async function createTables(client: PoolClient) {
  for (const sql of TABLES) {
    await client.query(sql)
  }
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  })

  const client = await pool.connect()
  try {
    // Diagnostics: understand the user and available schemas
    const info = await client.query(`
      SELECT
        current_user,
        current_database(),
        has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public,
        has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_schema
    `)
    console.log('DB info:', JSON.stringify(info.rows[0]))

    const schemas = await client.query(`
      SELECT nspname, has_schema_privilege(current_user, nspname, 'CREATE') AS can_create
      FROM pg_namespace
      WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema'
      ORDER BY nspname
    `)
    console.log('Schemas:', JSON.stringify(schemas.rows))

    // Strategy 1: try public schema directly
    if (info.rows[0].can_create_in_public) {
      console.log('Using public schema')
      await createTables(client)
      console.log('Migration complete (public schema)')
      return
    }

    // Strategy 2: try the user's own schema ("$user" search_path)
    const currentUser = info.rows[0].current_user as string
    const userSchemaResult = schemas.rows.find(
      (r: any) => r.nspname === currentUser && r.can_create
    )
    if (userSchemaResult) {
      console.log(`Using "${currentUser}" schema`)
      await client.query(`SET search_path TO "${currentUser}"`)
      await createTables(client)
      console.log(`Migration complete ("${currentUser}" schema)`)
      return
    }

    // Strategy 3: find any writable schema
    const writableSchema = schemas.rows.find((r: any) => r.can_create)
    if (writableSchema) {
      console.log(`Using "${writableSchema.nspname}" schema`)
      await client.query(`SET search_path TO "${writableSchema.nspname}"`)
      await createTables(client)
      console.log(`Migration complete ("${writableSchema.nspname}" schema)`)
      return
    }

    // Strategy 4: try creating our own schema
    if (info.rows[0].can_create_schema) {
      console.log('Creating "app" schema')
      await client.query('CREATE SCHEMA IF NOT EXISTS app')
      await client.query('SET search_path TO app')
      await createTables(client)
      console.log('Migration complete ("app" schema)')
      return
    }

    throw new Error(
      `No writable schema found. User "${currentUser}" cannot create tables in any available schema.`
    )
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
