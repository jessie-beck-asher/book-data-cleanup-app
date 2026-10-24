// Builds the optimized JPEG preview for one image. Reads local files (and downloads a current Square image once).
// Nothing is sent to Square.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface Body { isbn?: string, key?: string, crop?: { zoom?: number, cx?: number, cy?: number } }

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

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

  const name = optimizedName(key)
  await mkdir(join(DATA_DIR, 'images', 'optimized', isbn), { recursive: true })
  await writeFile(optimizedPath(isbn, key), result.buffer)
  // Remembers which crop this file was made from, so the update can tell whether the preview is still current.
  await writeFile(`${optimizedPath(isbn, key)}.json`, JSON.stringify({ crop: { zoom: crop.zoom, cx: crop.cx, cy: crop.cy }, warnings: result.warnings, width: result.width, bytes: result.bytes }))
  return {
    url: `/api/images/optimized/${isbn}/${name}`,
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    quality: result.quality,
    warnings: result.warnings
  }
})
