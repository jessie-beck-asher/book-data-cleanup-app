// Saves a picture the owner uploaded for a bookish item. Local only; nothing is sent to Square.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const EXTENSIONS: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' }

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const snapshot = await readSnapshot()
  const item = snapshot?.items.find(candidate => candidate.id === id)
  if (!item || getItemIsbns(item).size !== 0) throw createError({ statusCode: 404, statusMessage: 'Item not found' })

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

  const uploadId = `up-${Date.now()}`
  await ensureBookishUploadDir(id)
  await writeFile(join(bookishUploadDir(id), `${uploadId}.${extension}`), file.data)
  return { id: uploadId }
})
