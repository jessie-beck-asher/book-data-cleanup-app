// Deletes a picture that was uploaded for a bookish item and has not been sent to Square. Local file only.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const name = getRouterParam(event, 'name') ?? ''
  if (!UPLOAD_FILE.test(name)) throw createError({ statusCode: 400, statusMessage: 'Bad image name' })
  await removeBookishUploads(id, [name.replace(/\.[a-z]+$/, '')])
  return { deleted: true }
})
