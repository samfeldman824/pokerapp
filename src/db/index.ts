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

function createPool() {
  const rawUrl = process.env.DATABASE_URL || ''
  try {
    const dbUrl = new URL(rawUrl)
    return new Pool({
      host: dbUrl.hostname,
      port: parseInt(dbUrl.port || '5432'),
      database: dbUrl.pathname.slice(1),
      user: dbUrl.username,
      password: dbUrl.password,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    })
  } catch {
    // During `next build`, DATABASE_URL is a placeholder — create a pool that
    // won't actually connect until a real URL is available at runtime.
    return new Pool({ connectionString: rawUrl || 'postgresql://localhost/pokerapp' })
  }
}

const pool = createPool()

export const db = drizzle(pool, { schema })
export type DB = typeof db
