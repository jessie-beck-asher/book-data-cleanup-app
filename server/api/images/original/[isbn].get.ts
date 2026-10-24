// Serves a saved ISBNdb original cover from the local images folder.
import { readFile } from 'node:fs/promises'

export default defineEventHandler(async (event) => {
  const isbn = getRouterParam(event, 'isbn') ?? ''
  if (!/^\d{13}$/.test(isbn)) throw createError({ statusCode: 400, statusMessage: 'Not an ISBN-13' })
  try {
    const file = await readFile(originalImagePath(isbn))
    setHeader(event, 'Content-Type', 'image/jpeg')
    return file
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'No saved cover for this ISBN' })
  }
})
