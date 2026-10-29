// Serves a picture the owner uploaded for a bookish item.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const name = getRouterParam(event, 'name') ?? ''
  if (!UPLOAD_FILE.test(name)) throw createError({ statusCode: 400, statusMessage: 'Bad image name' })
  try {
    setHeader(event, 'Content-Type', TYPES[name.split('.').pop()!]!)
    return await readFile(join(bookishUploadDir(id), name))
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'No such image' })
  }
})
