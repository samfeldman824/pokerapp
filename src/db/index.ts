import { loadEnvConfig } from '@next/env'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { normalizeDatabaseUrl } from './connection-string'
import * as schema from './schema'

loadEnvConfig(process.cwd())

const defaultConnectionString = 'postgresql://localhost/pokerapp'
const pool = new Pool({
  connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL || defaultConnectionString),
})

export const db = drizzle(pool, { schema })
export type DB = typeof db
