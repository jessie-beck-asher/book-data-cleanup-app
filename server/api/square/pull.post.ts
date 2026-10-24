// Read-only against Square: pages through the whole catalog and saves it to a local JSON file.
// Never overwrites an existing snapshot unless the request says replace: true.
let pulling = false

export default defineEventHandler(async (event) => {
  const body = await readBody<{ replace?: boolean }>(event).catch(() => null)

  const existing = await readSnapshot()
  if (existing && body?.replace !== true) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Snapshot already exists',
      data: { environment: existing.environment, pulledAt: existing.pulledAt }
    })
  }

  if (pulling) throw createError({ statusCode: 409, statusMessage: 'A pull is already running' })
  pulling = true
  try {
    const items = new Map<string, any>()
    const relatedObjects = new Map<string, any>()
    let environment: 'sandbox' | 'production' | undefined
    let cursor: string | undefined

    do {
      const result = await squareReadSearch('/v2/catalog/search', {
        object_types: ['ITEM'],
        include_related_objects: true,
        limit: 100,
        ...(cursor ? { cursor } : {})
      })
      environment = result.environment
      for (const object of result.json?.objects ?? []) items.set(object.id, object)
      for (const object of result.json?.related_objects ?? []) relatedObjects.set(object.id, object)
      cursor = result.json?.cursor
    } while (cursor)

    const snapshot: SquareSnapshot = {
      environment: environment!,
      pulledAt: new Date().toISOString(),
      items: [...items.values()],
      relatedObjects: [...relatedObjects.values()]
    }
    await writeSnapshot(snapshot)

    return {
      environment: snapshot.environment,
      pulledAt: snapshot.pulledAt,
      ...countBooks(snapshot.items),
      savedTo: SNAPSHOT_DISPLAY_PATH
    }
  } finally {
    pulling = false
  }
})
