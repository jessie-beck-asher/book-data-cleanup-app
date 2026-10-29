// Pictures the owner uploads for a bookish item. They are saved on this computer only, until the item is updated in Square.
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

export const UPLOAD_ID = /^up-\d{10,16}$/
export const UPLOAD_FILE = /^up-\d{10,16}\.(jpg|png|webp)$/
const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/

export const isUploadId = (id: string) => UPLOAD_ID.test(id)

export function bookishUploadDir(itemId: string) {
  if (!ITEM_ID.test(itemId)) throw createError({ statusCode: 400, statusMessage: 'Bad item id' })
  return join(DATA_DIR, 'images', 'bookish-uploaded', itemId)
}

// Oldest first. The id is the file name without its extension.
export async function listBookishUploads(itemId: string) {
  let names: string[] = []
  try {
    names = (await readdir(bookishUploadDir(itemId))).filter(name => UPLOAD_FILE.test(name)).sort()
  } catch {
    return []
  }
  return Promise.all(names.map(async name => ({ id: name.replace(/\.[a-z]+$/, ''), name, bytes: (await stat(join(bookishUploadDir(itemId), name))).size })))
}

export async function readBookishUpload(itemId: string, uploadId: string): Promise<Buffer> {
  const found = (await listBookishUploads(itemId)).find(upload => upload.id === uploadId)
  if (!found) throw createError({ statusCode: 404, statusMessage: 'That uploaded image is missing' })
  return readFile(join(bookishUploadDir(itemId), found.name))
}

export async function removeBookishUploads(itemId: string, uploadIds: string[]) {
  const all = await listBookishUploads(itemId)
  for (const upload of all) if (uploadIds.includes(upload.id)) await rm(join(bookishUploadDir(itemId), upload.name), { force: true })
}

export async function ensureBookishUploadDir(itemId: string) {
  await mkdir(bookishUploadDir(itemId), { recursive: true })
}
