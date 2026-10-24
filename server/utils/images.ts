import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
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

export function optimizedName(key: string) {
  return `${key.replace(/[^A-Za-z0-9_-]/g, '-')}.jpg`
}
export function optimizedPath(isbn: string, key: string) {
  return join(DATA_DIR, 'images', 'optimized', isbn, optimizedName(key))
}

// Square images are saved locally the first time they are needed, so a copy exists before anything is ever deleted in Square.
export async function loadSquareImage(imageId: string): Promise<Buffer> {
  const file = join(DATA_DIR, 'images', 'square', imageId)
  try {
    return await readFile(file)
  } catch {
    // Not saved yet; download it below.
  }
  const snapshot = await readSnapshot()
  const url = snapshot?.relatedObjects.find(object => object.id === imageId && object.type === 'IMAGE')?.image_data?.url as string | undefined
  if (!url?.startsWith('https://')) throw createError({ statusCode: 404, statusMessage: 'That Square image is not in the snapshot' })
  const response = await fetch(url)
  if (!response.ok) throw createError({ statusCode: 502, statusMessage: `Could not download the Square image (status ${response.status})` })
  const buffer = Buffer.from(await response.arrayBuffer())
  await mkdir(join(DATA_DIR, 'images', 'square'), { recursive: true })
  await writeFile(file, buffer)
  return buffer
}
