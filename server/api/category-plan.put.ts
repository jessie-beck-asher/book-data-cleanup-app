// Saves the whole planning tree locally. Does not touch Square.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ nodes?: unknown }>(event).catch(() => null)
  const nodes = cleanCategoryPlan(body?.nodes)
  await writeCategoryPlan(nodes)
  return { saved: true }
})
