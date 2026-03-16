const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export function normalizeDatabaseUrl(connectionString: string): string {
  try {
    const parsed = new URL(connectionString)
    if (LOCAL_DB_HOSTS.has(parsed.hostname)) {
      return connectionString
    }

    const sslMode = parsed.searchParams.get('sslmode')
    if (!sslMode || sslMode === 'prefer' || sslMode === 'require' || sslMode === 'verify-ca') {
      parsed.searchParams.set('sslmode', 'verify-full')
    }

    return parsed.toString()
  } catch (error) {
    console.warn('Could not normalize DATABASE_URL sslmode; using original value.', error)
    return connectionString
  }
}
