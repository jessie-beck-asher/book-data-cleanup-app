import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ISBNDB_BATCH_URL = 'https://api2.isbndb.com/books'
export const ISBNDB_FILE = join(DATA_DIR, 'isbndb-data.json')

export interface IsbndbRecord {
  status: 'found' | 'no_match'
  fetchedAt: string
  book?: any
  // Whether the original cover was saved locally from the ISBNdb link.
  cover?: 'saved' | 'none' | 'failed'
}
export type IsbndbStore = Record<string, IsbndbRecord>

export async function readIsbndbStore(): Promise<IsbndbStore> {
  try {
    return JSON.parse(await readFile(ISBNDB_FILE, 'utf8'))
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

export function writeIsbndbStore(store: IsbndbStore) {
  return writeJsonAtomic(ISBNDB_FILE, store)
}

// Basic plan allows up to 100 ISBNs per request; quota is charged per ISBN.
export async function isbndbBatchLookup(isbns: string[]) {
  const key = process.env.ISBNDB_API_KEY?.trim()
  if (!key) throw createError({ statusCode: 400, statusMessage: 'ISBNDB_API_KEY is not set' })
  if (isbns.length === 0 || isbns.length > 100) {
    throw createError({ statusCode: 400, statusMessage: 'Batch must contain 1 to 100 ISBNs' })
  }

  const response = await fetch(ISBNDB_BATCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': key },
    body: JSON.stringify({ isbns })
  })
  const json = await response.json().catch(() => null)
  if (!response.ok) {
    // Only the status and ISBNdb's own message are surfaced, never request headers or the key.
    const message = typeof json?.errorMessage === 'string' ? json.errorMessage.slice(0, 200) : undefined
    throw createError({ statusCode: response.status, statusMessage: 'ISBNdb request failed', data: { message } })
  }
  return json
}
