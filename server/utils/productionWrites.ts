// Writes to the PRODUCTION Square account are off unless the owner lists specific item IDs in data/production-writes.json:
//   { "allowedItemIds": ["ITEM_ID"] }
// or, to allow every book (still one item at a time, with review, version check and backup): { "allowAllBooks": true }
// The file is read on every write, so removing an ID (or the file) shuts it off again immediately. The sandbox is always allowed.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

async function readSettings(): Promise<{ ids: string[], allowAll: boolean }> {
  try {
    const parsed = JSON.parse(await readFile(join(DATA_DIR, 'production-writes.json'), 'utf8'))
    const ids = Array.isArray(parsed?.allowedItemIds) ? parsed.allowedItemIds.filter((id: unknown): id is string => typeof id === 'string') : []
    return { ids, allowAll: parsed?.allowAllBooks === true }
  } catch {
    return { ids: [], allowAll: false }
  }
}

// True when production writes are open for at least one item. Used as a backstop in the Square write layer.
export async function productionWritesOpen() {
  const { ids, allowAll } = await readSettings()
  return allowAll || ids.length > 0
}

export async function writesEnabledFor(itemId: string) {
  if (currentEnvironmentName() === 'sandbox') return true
  const { ids, allowAll } = await readSettings()
  return allowAll || ids.includes(itemId)
}

export async function assertWritesEnabledFor(itemId: string) {
  if (!(await writesEnabledFor(itemId))) {
    throw createError({ statusCode: 403, statusMessage: 'Writing to the production Square account is not enabled for this item' })
  }
}
