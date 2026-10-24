// Serves an optimized preview made by the Optimize button.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  const isbn = getRouterParam(event, 'isbn') ?? ''
  const name = getRouterParam(event, 'name') ?? ''
  if (!/^\d{13}$/.test(isbn) || !/^[A-Za-z0-9_-]+\.jpg$/.test(name)) throw createError({ statusCode: 400, statusMessage: 'Bad image name' })
  try {
    const file = await readFile(join(DATA_DIR, 'images', 'optimized', isbn, name))
    setHeader(event, 'Content-Type', 'image/jpeg')
    setHeader(event, 'Cache-Control', 'no-store')
    return file
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'No such image' })
  }
})
