// Copies of an item exactly as Square had it just before this app changed it, one file per change.
// They live in git-ignored data/ and are what the "revert" button sends back.
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface Backup {
  name: string
  savedAt: string
  // Why it was taken: right before an update, or right before a revert.
  reason: 'before-update' | 'before-revert'
  itemVersion: number | string
  item: any
}

export const BACKUP_NAME = /^[0-9TZ_-]{10,40}\.json$/
const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/

function backupDir(itemId: string) {
  if (!ITEM_ID.test(itemId)) throw createError({ statusCode: 400, statusMessage: 'Bad item id' })
  return join(DATA_DIR, 'backups', currentEnvironmentName(), itemId)
}

export async function saveBackup(itemId: string, item: any, reason: Backup['reason']): Promise<Backup> {
  const savedAt = new Date().toISOString()
  const name = `${savedAt.replace(/[:.]/g, '-')}.json`
  const backup: Backup = { name, savedAt, reason, itemVersion: item.version, item }
  await mkdir(backupDir(itemId), { recursive: true })
  await writeJsonAtomic(join(backupDir(itemId), name), backup)
  return backup
}

export async function readBackup(itemId: string, name: string): Promise<Backup> {
  if (!BACKUP_NAME.test(name)) throw createError({ statusCode: 400, statusMessage: 'Bad backup name' })
  try {
    return JSON.parse(await readFile(join(backupDir(itemId), name), 'utf8'))
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'That backup was not found' })
  }
}

// Newest first.
export async function listBackups(itemId: string): Promise<Backup[]> {
  let names: string[]
  try {
    names = (await readdir(backupDir(itemId))).filter(name => BACKUP_NAME.test(name))
  } catch (error: any) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const backups = await Promise.all(names.map(name => readBackup(itemId, name)))
  return backups.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

// After Square changed an item, replace its copy in the local snapshot with Square's version.
export async function refreshSnapshotItem(itemId: string, removedImageIds: string[]) {
  const refreshed = await squareGet(`/v2/catalog/object/${itemId}?include_related_objects=true`)
  const snapshot = await readSnapshot()
  if (!snapshot || !refreshed?.object) return
  snapshot.items = snapshot.items.map(existing => existing.id === itemId ? refreshed.object : existing)
  const byId = new Map(snapshot.relatedObjects.map(object => [object.id, object]))
  for (const imageId of removedImageIds) byId.delete(imageId)
  for (const object of refreshed.related_objects ?? []) byId.set(object.id, object)
  snapshot.relatedObjects = [...byId.values()]
  await writeSnapshot(snapshot)
}
