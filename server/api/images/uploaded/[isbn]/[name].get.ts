// Serves an image the owner uploaded for a book.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

export default defineEventHandler(async (event) => {
  const isbn = getRouterParam(event, 'isbn') ?? ''
  const name = getRouterParam(event, 'name') ?? ''
  if (!/^\d{13}$/.test(isbn) || !UPLOAD_NAME.test(name)) throw createError({ statusCode: 400, statusMessage: 'Bad image name' })
  try {
    const file = await readFile(join(uploadedDir(isbn), name))
    setHeader(event, 'Content-Type', TYPES[name.split('.').pop()!]!)
    return file
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'No such image' })
  }
})
