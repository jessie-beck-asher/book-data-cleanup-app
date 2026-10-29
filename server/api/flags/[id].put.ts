// Marks or unmarks one item as "needs a talk with the book owner". Local file only; nothing is sent to Square.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const body = await readBody<{ flagged?: boolean }>(event).catch(() => null)
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || typeof body?.flagged !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'Bad request' })
  const snapshot = await readSnapshot()
  if (!snapshot?.items.some(item => item.id === id)) throw createError({ statusCode: 404, statusMessage: 'Item not found' })
  await setFlag(id, body.flagged)
  return { flagged: body.flagged }
})
