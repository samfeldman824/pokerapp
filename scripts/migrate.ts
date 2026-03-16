import { Pool, type PoolClient } from 'pg'
import { normalizeDatabaseUrl } from '../src/db/connection-string'

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

const REQUIRED_TABLES = ['games', 'players', 'hands', 'hand_actions', 'hand_results'] as const

const REQUIRED_TABLE_COLUMNS: Record<(typeof REQUIRED_TABLES)[number], readonly string[]> = {
  games: ['id', 'config', 'status', 'created_at'],
  players: ['id', 'game_id', 'display_name', 'seat_index', 'token'],
  hands: ['id', 'game_id', 'hand_number', 'dealer_seat_index', 'community_cards', 'pot_total'],
  hand_actions: ['id', 'hand_id', 'player_id', 'phase', 'action_type', 'ordering'],
  hand_results: ['id', 'hand_id', 'player_id', 'winnings'],
}

type DbInfoRow = {
  current_user: string
  current_database: string
  can_create_in_public: boolean
  can_create_schema: boolean
}

type SchemaPermissionRow = {
  nspname: string
  can_create: boolean
}

type SearchPathRow = {
  schemas: string[]
}

type ExistingTableRow = {
  table_schema: string
  table_name: (typeof REQUIRED_TABLES)[number]
}

async function hasCompatibleExistingSchema(client: PoolClient): Promise<boolean> {
  const searchPathResult = await client.query<SearchPathRow>(
    'SELECT current_schemas(true) AS schemas'
  )
  const searchPathSchemas = new Set(searchPathResult.rows[0]?.schemas ?? [])

  const { rows: existingTables } = await client.query<ExistingTableRow>(
    `
      SELECT
        table_schema,
        table_name
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        AND table_name = ANY($1::text[])
        AND table_type = 'BASE TABLE'
    `,
    [REQUIRED_TABLES]
  )

  const schemasWithAllTables = new Set<string>()
  const tablesBySchema = new Map<string, Set<(typeof REQUIRED_TABLES)[number]>>()

  for (const row of existingTables) {
    const tables = tablesBySchema.get(row.table_schema) ?? new Set<(typeof REQUIRED_TABLES)[number]>()
    tables.add(row.table_name)
    tablesBySchema.set(row.table_schema, tables)
  }

  for (const [schemaName, tables] of tablesBySchema.entries()) {
    const hasAllTables = REQUIRED_TABLES.every((tableName) => tables.has(tableName))
    if (hasAllTables) {
      schemasWithAllTables.add(schemaName)
    }
  }

  const compatibleSchemas = [...schemasWithAllTables].filter((schemaName) =>
    searchPathSchemas.has(schemaName)
  )

  if (compatibleSchemas.length === 0) {
    return false
  }

  const compatibleSchema = compatibleSchemas[0]
  console.log(`Checking compatible existing schema: "${compatibleSchema}"`)

  for (const tableName of REQUIRED_TABLES) {
    const { rows: columnRows } = await client.query<{ column_name: string }>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
      `,
      [compatibleSchema, tableName]
    )

    const columns = new Set(columnRows.map((row) => row.column_name))
    for (const requiredColumn of REQUIRED_TABLE_COLUMNS[tableName]) {
      if (!columns.has(requiredColumn)) {
        return false
      }
    }
  }

  console.log(
    `Compatible non-writable schema found on search_path: "${compatibleSchema}" with required tables/columns.`
  )
  return true
}

async function createTables(client: PoolClient) {
  for (const sql of TABLES) {
    await client.query(sql)
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for migrations')
  }

  const pool = new Pool({
    connectionString: normalizeDatabaseUrl(connectionString),
  })

  const client = await pool.connect()
  try {
    // Diagnostics: understand the user and available schemas
    const infoResult = await client.query<DbInfoRow>(`
      SELECT
        current_user,
        current_database(),
        has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public,
        has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_schema
    `)
    const info = infoResult.rows[0]
    console.log('DB info:', JSON.stringify(info))

    const schemasResult = await client.query<SchemaPermissionRow>(`
      SELECT nspname, has_schema_privilege(current_user, nspname, 'CREATE') AS can_create
      FROM pg_namespace
      WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema'
      ORDER BY nspname
    `)
    const schemas = schemasResult.rows
    console.log('Schemas:', JSON.stringify(schemas))

    // Strategy 1: try public schema directly
    if (info.can_create_in_public) {
      console.log('Using public schema')
      await createTables(client)
      console.log('Migration complete (public schema)')
      return
    }

    // Strategy 2: try the user's own schema ("$user" search_path)
    const currentUser = info.current_user
    const userSchemaResult = schemas.find(
      (schema) => schema.nspname === currentUser && schema.can_create
    )
    if (userSchemaResult) {
      console.log(`Using "${currentUser}" schema`)
      await client.query(`SET search_path TO "${currentUser}"`)
      await createTables(client)
      console.log(`Migration complete ("${currentUser}" schema)`)
      return
    }

    // Strategy 3: find any writable schema
    const writableSchema = schemas.find((schema) => schema.can_create)
    if (writableSchema) {
      console.log(`Using "${writableSchema.nspname}" schema`)
      await client.query(`SET search_path TO "${writableSchema.nspname}"`)
      await createTables(client)
      console.log(`Migration complete ("${writableSchema.nspname}" schema)`)
      return
    }

    // Strategy 4: try creating our own schema
    if (info.can_create_schema) {
      console.log('Creating "app" schema')
      await client.query('CREATE SCHEMA IF NOT EXISTS app')
      await client.query('SET search_path TO app')
      await createTables(client)
      console.log('Migration complete ("app" schema)')
      return
    }

    if (await hasCompatibleExistingSchema(client)) {
      console.log('No writable schema, but compatible tables already exist. Skipping migration.')
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
