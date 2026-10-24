// Connection test: reads at most ONE catalog item. Read-only.
export default defineEventHandler(async () => {
  const { environment, json } = await squareReadSearch('/v2/catalog/search', {
    object_types: ['ITEM'],
    limit: 1
  })
  const objects = json?.objects ?? []
  return {
    environment,
    itemCount: objects.length,
    item: objects[0] ?? null
  }
})
