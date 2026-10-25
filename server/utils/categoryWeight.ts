// The owner's own list of genres and shipping weights by ISBN (data/category-weight.json). Used when ISBNdb has no weight,
// and as a last source of genre suggestions. Weights are in pounds.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface ListedBook { category: string[], weight: number | null }

export async function readCategoryWeight(): Promise<Record<string, ListedBook>> {
  let rows: any
  try {
    rows = JSON.parse(await readFile(join(DATA_DIR, 'category-weight.json'), 'utf8'))
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
  const byIsbn: Record<string, ListedBook> = {}
  for (const row of Array.isArray(rows) ? rows : []) {
    if (typeof row?.isbn !== 'string') continue
    byIsbn[row.isbn] = {
      category: Array.isArray(row.category) ? row.category.filter((name: unknown) => typeof name === 'string') : [],
      weight: typeof row.weight === 'number' && row.weight > 0 ? row.weight : null
    }
  }
  return byIsbn
}
