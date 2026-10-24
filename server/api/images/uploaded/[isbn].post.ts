// Saves an image the owner uploaded for a book. Nothing is sent to Square.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const EXTENSIONS: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' }

export default defineEventHandler(async (event) => {
  const isbn = getRouterParam(event, 'isbn') ?? ''
  if (!/^\d{13}$/.test(isbn)) throw createError({ statusCode: 400, statusMessage: 'Not an ISBN-13' })

  const file = (await readMultipartFormData(event))?.find(part => part.name === 'file')
  if (!file?.data.length) throw createError({ statusCode: 400, statusMessage: 'No file received' })
  if (file.data.length > MAX_UPLOAD_BYTES) throw createError({ statusCode: 413, statusMessage: 'Image is over 15 MB' })

  let format: string | undefined
  try {
    format = (await sharp(file.data).metadata()).format
  } catch {
    format = undefined
  }
  const extension = format ? EXTENSIONS[format] : undefined
  if (!extension) throw createError({ statusCode: 400, statusMessage: 'Only JPEG, PNG or WebP images are accepted' })

  const name = `${Date.now()}.${extension}`
  await mkdir(uploadedDir(isbn), { recursive: true })
  await writeFile(join(uploadedDir(isbn), name), file.data)
  return { name }
})
