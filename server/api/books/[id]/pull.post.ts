// Pulls ONE item from Square (a read only) and replaces its copy in the local snapshot.
// Saved edits are not touched. Nothing is written to Square.
// With { onlyIfChanged: true } (what the detail page sends when it opens) the copy is replaced only when Square's version of the
// item or its variation differs from the local one.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const snapshot = await readSnapshot()
  if (!snapshot?.items.some(item => item.id === id)) throw createError({ statusCode: 404, statusMessage: 'Book not found' })

  const live = await squareGet(`/v2/catalog/object/${encodeURIComponent(id)}?include_related_objects=true`)
  if (!live?.object || live.object.is_deleted) throw createError({ statusCode: 404, statusMessage: 'This item no longer exists in Square' })

  const body = await readBody(event).catch(() => null)
  if (body?.onlyIfChanged) {
    const local = snapshot.items.find(item => item.id === id)
    const versions = (item: any) => [item?.version, ...(item?.item_data?.variations ?? []).map((variation: any) => `${variation.id}:${variation.version}`)].join('|')
    if (versions(live.object) === versions(local)) return { pulled: false, version: live.object.version }
  }

  await refreshSnapshotItem(id, [])
  return { pulled: true, version: live.object.version }
})
