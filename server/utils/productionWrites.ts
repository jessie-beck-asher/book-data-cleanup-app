// Writes to the PRODUCTION Square account are off unless the owner lists specific item IDs in data/production-writes.json:
//   { "allowedItemIds": ["ITEM_ID"] }
// The file is read on every write, so removing an ID (or the file) shuts it off again immediately. The sandbox is always allowed.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function productionAllowedItemIds(): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(join(DATA_DIR, 'production-writes.json'), 'utf8'))
    return Array.isArray(parsed?.allowedItemIds) ? parsed.allowedItemIds.filter((id: unknown): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export async function writesEnabledFor(itemId: string) {
  return currentEnvironmentName() === 'sandbox' || (await productionAllowedItemIds()).includes(itemId)
}

export async function assertWritesEnabledFor(itemId: string) {
  if (!(await writesEnabledFor(itemId))) {
    throw createError({ statusCode: 403, statusMessage: 'Writing to the production Square account is not enabled for this item' })
  }
}
