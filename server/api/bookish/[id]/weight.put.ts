// Saves (or clears) the shipping weight in pounds for one bookish item. Local file only; nothing is sent to Square.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const body = await readBody<{ pounds?: number | null }>(event).catch(() => null)
  const pounds = body?.pounds ?? null
  if (pounds !== null && (typeof pounds !== 'number' || !Number.isFinite(pounds) || pounds <= 0 || pounds > 1000)) {
    throw createError({ statusCode: 400, statusMessage: 'Weight must be a number above 0 and up to 1000 pounds' })
  }

  const snapshot = await readSnapshot()
  const item = snapshot?.items.find(candidate => candidate.id === id)
  if (!item || getItemIsbns(item).size !== 0) throw createError({ statusCode: 404, statusMessage: 'Item not found' })

  const rounded = pounds === null ? null : Math.round(pounds * 10000) / 10000
  await setBookishWeight(id, rounded)
  return { pounds: rounded }
})
