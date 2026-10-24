import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

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

export function writeSnapshot(snapshot: SquareSnapshot) {
  return writeJsonAtomic(SNAPSHOT_FILE, snapshot)
}

// GTIN (upc) wins; SKU is used only when a variation has no GTIN.
export function getItemIsbns(item: any): Set<string> {
  const isbns = new Set<string>()
  for (const variation of item?.item_data?.variations ?? []) {
    const data = variation?.item_variation_data ?? {}
    const identifier = data.upc?.toString().trim() ? data.upc : data.sku
    const isbn = toIsbn13(identifier)
    if (isbn) isbns.add(isbn)
  }
  return isbns
}

// Counts only: no titles or ISBNs.
export function countBooks(items: any[]) {
  let books = 0
  let conflicting = 0
  let skipped = 0
  for (const item of items) {
    const { size } = getItemIsbns(item)
    if (size === 0) skipped++
    else if (size === 1) books++
    else conflicting++
  }
  return { totalItems: items.length, books, skipped, conflicting }
}
