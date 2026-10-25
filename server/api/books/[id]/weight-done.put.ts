// Remembers (locally) whether the shipping weight has been added by hand in Square. Does not touch Square.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const snapshot = await readSnapshot()
  const item = snapshot?.items.find(candidate => candidate.id === id)
  if (!item || getItemIsbns(item).size !== 1) throw createError({ statusCode: 404, statusMessage: 'Book not found' })

  const body = await readBody<{ done?: unknown }>(event).catch(() => null)
  if (typeof body?.done !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'Bad value' })
  await setWeightDone(id, body.done)
  return { done: body.done }
})
