// Pulls ONE item from Square (a read only) and replaces its copy in the local snapshot.
// Saved edits are not touched. Nothing is written to Square.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const snapshot = await readSnapshot()
  if (!snapshot?.items.some(item => item.id === id)) throw createError({ statusCode: 404, statusMessage: 'Book not found' })

  const live = await squareGet(`/v2/catalog/object/${encodeURIComponent(id)}?include_related_objects=true`)
  if (!live?.object || live.object.is_deleted) throw createError({ statusCode: 404, statusMessage: 'This item no longer exists in Square' })

  await refreshSnapshotItem(id, [])
  return { pulled: true, version: live.object.version }
})
