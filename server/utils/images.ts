import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

export function originalImagePath(isbn: string) {
  return join(DATA_DIR, 'images', 'original', `${isbn}.jpg`)
}

// Size of the saved ISBNdb original for a book, or null if none has been downloaded.
export async function readOriginalInfo(isbn: string) {
  const file = originalImagePath(isbn)
  try {
    const [info, meta] = await Promise.all([stat(file), sharp(file).metadata()])
    return { bytes: info.size, width: meta.width ?? 0, height: meta.height ?? 0 }
  } catch {
    return null
  }
}

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
export const UPLOAD_NAME = /^\d{10,16}\.(jpg|png|webp)$/

export function uploadedDir(isbn: string) {
  return join(DATA_DIR, 'images', 'uploaded', isbn)
}

// Images the owner uploaded for a book, oldest first.
export async function listUploaded(isbn: string) {
  let names: string[] = []
  try {
    names = (await readdir(uploadedDir(isbn))).filter(name => UPLOAD_NAME.test(name)).sort()
  } catch {
    return []
  }
  return Promise.all(names.map(async name => ({ name, bytes: (await stat(join(uploadedDir(isbn), name))).size })))
}
