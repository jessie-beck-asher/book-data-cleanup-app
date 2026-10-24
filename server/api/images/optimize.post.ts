// Builds the optimized JPEG preview for one image. Reads local files (and downloads a current Square image once).
// Nothing is sent to Square.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface Body { isbn?: string, key?: string, crop?: { zoom?: number, cx?: number, cy?: number } }

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

// Square images are saved the first time they are needed, so a copy exists locally before anything is ever deleted in Square.
async function loadSquareImage(imageId: string): Promise<Buffer> {
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

async function loadSource(isbn: string, key: string): Promise<Buffer> {
  const [kind, rest = ''] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
  try {
    if (kind === 'isbndb' && rest === isbn) return await readFile(originalImagePath(isbn))
    if (kind === 'upload' && UPLOAD_NAME.test(rest)) return await readFile(join(uploadedDir(isbn), rest))
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'That image file is missing' })
  }
  if (kind === 'square' && /^[A-Za-z0-9_-]{1,64}$/.test(rest)) return loadSquareImage(rest)
  throw createError({ statusCode: 400, statusMessage: 'Unknown image' })
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  const { isbn, key, crop } = body ?? {}
  if (!isbn || !/^\d{13}$/.test(isbn) || !key) throw createError({ statusCode: 400, statusMessage: 'Missing ISBN or image' })
  if (!crop || !isNumber(crop.zoom) || !isNumber(crop.cx) || !isNumber(crop.cy) || crop.zoom < 0.5 || crop.zoom > 4 || Math.abs(crop.cx) > 5 || Math.abs(crop.cy) > 5) {
    throw createError({ statusCode: 400, statusMessage: 'Bad crop values' })
  }

  const result = await optimizeImage(await loadSource(isbn, key), { zoom: crop.zoom, cx: crop.cx, cy: crop.cy })

  const name = `${key.replace(/[^A-Za-z0-9_-]/g, '-')}.jpg`
  const dir = join(DATA_DIR, 'images', 'optimized', isbn)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, name), result.buffer)
  return {
    url: `/api/images/optimized/${isbn}/${name}`,
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    quality: result.quality,
    warnings: result.warnings
  }
})
