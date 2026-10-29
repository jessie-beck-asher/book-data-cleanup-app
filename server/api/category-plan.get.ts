export default defineEventHandler(async () => ({ nodes: await readCategoryPlan() }))
