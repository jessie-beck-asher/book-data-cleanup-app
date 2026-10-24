import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const DATA_DIR = join(process.cwd(), 'data')
export const SNAPSHOT_FILE = join(DATA_DIR, 'square-snapshot.json')
export const SNAPSHOT_DISPLAY_PATH = 'data/square-snapshot.json'

export interface SquareSnapshot {
  environment: 'sandbox' | 'production'
  pulledAt: string
  items: any[]
  relatedObjects: any[]
}

export async function readSnapshot(): Promise<SquareSnapshot | null> {
  try {
    return JSON.parse(await readFile(SNAPSHOT_FILE, 'utf8'))
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

// Write to a temp file, then rename, so a crash never leaves a half-written snapshot.
export async function writeSnapshot(snapshot: SquareSnapshot) {
  await mkdir(DATA_DIR, { recursive: true })
  const tempFile = `${SNAPSHOT_FILE}.tmp`
  await writeFile(tempFile, JSON.stringify(snapshot, null, 2))
  await rename(tempFile, SNAPSHOT_FILE)
}

// Counts only: no titles or ISBNs. GTIN (upc) wins; SKU is used only when a variation has no GTIN.
export function countBooks(items: any[]) {
  let books = 0
  let conflicting = 0
  let skipped = 0
  for (const item of items) {
    const isbns = new Set<string>()
    for (const variation of item?.item_data?.variations ?? []) {
      const data = variation?.item_variation_data ?? {}
      const identifier = data.upc?.toString().trim() ? data.upc : data.sku
      const isbn = toIsbn13(identifier)
      if (isbn) isbns.add(isbn)
    }
    if (isbns.size === 0) skipped++
    else if (isbns.size === 1) books++
    else conflicting++
  }
  return { totalItems: items.length, books, skipped, conflicting }
}
