// Puts ONE item back to a saved earlier copy (sandbox only for now).
// Square item updates are full replacements, so the old copy is sent whole, carrying the item's current version.
import sharp from 'sharp'

let reverting = false

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const body = await readBody<{ confirm?: boolean, backup?: string }>(event).catch(() => null)
  if (body?.confirm !== true || !body.backup) throw createError({ statusCode: 400, statusMessage: 'The revert needs a backup and your click' })
  await assertWritesEnabledFor(id)
  if (reverting) throw createError({ statusCode: 409, statusMessage: 'A revert is already running' })
  reverting = true

  const done: string[] = []
  try {
    const backup = await readBackup(id, body.backup)
    if (backup.item?.id !== id) throw createError({ statusCode: 400, statusMessage: 'That backup is for a different item' })

    const live = await squareGet(`/v2/catalog/object/${id}?include_related_objects=true`)
    if (!live?.object || live.object.is_deleted) throw createError({ statusCode: 409, statusMessage: 'The item no longer exists in Square' })

    // The current state is saved too, so a revert can itself be undone.
    await saveBackup(id, live.object, 'before-revert')
    done.push('Saved a backup of the item as it is now')

    const item = structuredClone(backup.item)
    item.version = live.object.version
    const liveVariations = new Map<string, any>((live.object.item_data?.variations ?? []).map((variation: any) => [variation.id, variation]))
    for (const variation of item.item_data?.variations ?? []) {
      const current = liveVariations.get(variation.id)
      if (current) variation.version = current.version
    }

    // Images the old copy used that no longer exist in Square are uploaded again from the local copies (they get new IDs).
    const liveImageIds = new Set<string>(live.object.item_data?.image_ids ?? [])
    const oldImageIds: string[] = [...new Set<string>([
      ...(item.item_data?.image_ids ?? []),
      ...(item.item_data?.variations ?? []).flatMap((variation: any) => variation.item_variation_data?.image_ids ?? [])
    ])]
    const newIds = new Map<string, string>()
    for (const imageId of oldImageIds) {
      if (liveImageIds.has(imageId)) continue
      const existing = await squareGet(`/v2/catalog/object/${imageId}`).catch(() => null)
      if (existing?.object && !existing.object.is_deleted) continue
      let file: Buffer
      try {
        file = await loadSquareImage(imageId)
      } catch {
        throw createError({ statusCode: 409, statusMessage: `Image ${imageId} is gone from Square and no local copy was saved, so this cannot be reverted` })
      }
      const format = (await sharp(file).metadata()).format ?? 'jpeg'
      const form = new FormData()
      form.append('request', new Blob([JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        image: { type: 'IMAGE', id: '#image', image_data: { caption: item.item_data?.name ?? '' } }
      })], { type: 'application/json' }))
      form.append('file', new Blob([new Uint8Array(file)], { type: `image/${format}` }), `${id}.${format === 'jpeg' ? 'jpg' : format}`)
      const result = await squareWriteForm('/v2/catalog/images', form)
      newIds.set(imageId, result.image.id)
      done.push('Uploaded an image that had been deleted')
    }
    const swap = (ids: string[] | undefined) => ids?.map(imageId => newIds.get(imageId) ?? imageId)
    if (item.item_data?.image_ids) item.item_data.image_ids = swap(item.item_data.image_ids)
    for (const variation of item.item_data?.variations ?? []) {
      if (variation.item_variation_data?.image_ids) variation.item_variation_data.image_ids = swap(variation.item_variation_data.image_ids)
    }

    await squareWriteJson('/v2/catalog/object', { idempotency_key: crypto.randomUUID(), object: item })
    done.push('Put the item back to the saved version')

    // Images the item had but the old copy did not (such as ones this app uploaded) are deleted, local copy first,
    // unless another Square item uses them.
    const keep = new Set<string>(item.item_data?.image_ids ?? [])
    const snapshot = await readSnapshot()
    const usedElsewhere = new Set<string>()
    for (const other of snapshot?.items ?? []) {
      if (other.id === id) continue
      for (const imageId of other.item_data?.image_ids ?? []) usedElsewhere.add(imageId)
    }
    const problems: string[] = []
    const removable: string[] = []
    for (const imageId of liveImageIds) {
      if (keep.has(imageId) || usedElsewhere.has(imageId)) continue
      try {
        await loadSquareImage(imageId)
        removable.push(imageId)
      } catch {
        problems.push(`Image ${imageId} was left in Square because a local copy could not be saved first.`)
      }
    }
    if (removable.length) {
      try {
        await squareWriteJson('/v2/catalog/batch-delete', { object_ids: removable })
        done.push(`Deleted ${removable.length} image${removable.length === 1 ? '' : 's'} the old version did not have (local copies kept)`)
      } catch (error: any) {
        problems.push(`Deleting images failed: ${error?.statusMessage ?? 'unknown error'}. The item itself was reverted.`)
      }
    }

    await refreshSnapshotItem(id, removable)
    return { reverted: true, steps: done, problems }
  } catch (error: any) {
    throw createError({ statusCode: error?.statusCode ?? 500, statusMessage: error?.statusMessage ?? 'Revert failed', data: { ...(error?.data ?? {}), completedSteps: done } })
  } finally {
    reverting = false
  }
})
