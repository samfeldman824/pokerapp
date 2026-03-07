/**
 * Database client — initialises a Drizzle ORM instance backed by a pg connection pool.
 *
 * `loadEnvConfig` is called here (rather than relying on Next.js's built-in env loading)
 * because this module is also imported by `server.ts`, which runs outside the Next.js
 * runtime and therefore doesn't have `.env` variables injected automatically.
 */

import { loadEnvConfig } from '@next/env'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

loadEnvConfig(process.cwd())

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

export const db = drizzle(pool, { schema })
export type DB = typeof db
