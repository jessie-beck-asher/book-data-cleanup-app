// Updates ONE bookish item in Square: saves a backup, uploads new images, upserts the item, renames kept images, then deletes removed images.

let sending = false

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const body = await readBody<{ confirm?: boolean, edit?: unknown }>(event).catch(() => null)
  if (body?.confirm !== true) throw createError({ statusCode: 400, statusMessage: 'The update needs your confirmation' })
  const edit = parseBookishEdit(body.edit)
  await assertWritesEnabledFor(id)
  if (sending) throw createError({ statusCode: 409, statusMessage: 'An update is already running' })
  sending = true

  const done: string[] = []
  try {
    // Rebuilt from scratch right now, so the version check is against Square as it is at this moment.
    const plan = await makeBookishPlan(id, edit)
    if (plan.blockers.length || !plan.internal) throw createError({ statusCode: 409, statusMessage: 'This update is blocked', data: { blockers: plan.blockers } })
    if (!plan.rows.some(row => row.changed)) throw createError({ statusCode: 409, statusMessage: 'Nothing would change' })
    const { item, original, uploads, deleteImageIds, renames } = plan.internal

    // 0. Keep Square's current copy of the item, so this update can be reverted. If this fails, nothing is sent.
    await saveBackup(id, original, 'before-update')
    done.push('Saved a backup of the item as it was')

    // 1. Upload the optimized images, unattached (so the item's version does not change yet).
    const newIds: Record<string, string> = {}
    for (const upload of uploads) {
      const form = new FormData()
      form.append('request', new Blob([JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        image: { type: 'IMAGE', id: '#image', image_data: { caption: upload.caption, name: upload.name } }
      })], { type: 'application/json' }))
      form.append('file', new Blob([new Uint8Array(upload.buffer)], { type: 'image/jpeg' }), `${upload.name}.jpg`)
      const result = await squareWriteForm('/v2/catalog/images', form)
      newIds[upload.slot] = result.image.id
      done.push(`Uploaded ${upload.label}`)
    }
    const swap = (ids: string[]) => ids.map(imageId => newIds[imageId] ?? imageId)
    item.item_data.image_ids = swap(item.item_data.image_ids ?? [])
    for (const variation of item.item_data.variations ?? []) {
      if (variation.item_variation_data?.image_ids) variation.item_variation_data.image_ids = swap(variation.item_variation_data.image_ids)
    }

    // 2. Update the item. The object carries the version read a moment ago, so Square rejects it if anything changed.
    await squareWriteJson('/v2/catalog/object', { idempotency_key: crypto.randomUUID(), object: item })
    done.push('Updated the item')

    // 2b. Rename images that stay on the item. This changes only the image's own name, in place. A failure does not undo the update.
    const problems: string[] = []
    for (const rename of renames) {
      try {
        const current = await squareGet(`/v2/catalog/object/${rename.imageId}`)
        const object = current.object
        object.image_data = { ...object.image_data, name: rename.name, caption: rename.caption }
        await squareWriteJson('/v2/catalog/object', { idempotency_key: crypto.randomUUID(), object })
        done.push(`Updated image ${rename.name}`)
      } catch (error: any) {
        problems.push(`Could not update image ${rename.imageId} (${rename.name}): ${error?.statusMessage ?? 'unknown error'}. The rest of the update went through.`)
      }
    }

    // 3. Delete removed and replaced images. Every one is saved locally first; a failure here does not undo the update.
    const deletable: string[] = []
    for (const imageId of deleteImageIds) {
      try {
        await loadSquareImage(imageId)
        deletable.push(imageId)
      } catch {
        problems.push(`Image ${imageId} was not deleted because a local copy could not be saved first.`)
      }
    }
    if (deletable.length) {
      try {
        await squareWriteJson('/v2/catalog/batch-delete', { object_ids: deletable })
        done.push(`Deleted ${deletable.length} image${deletable.length === 1 ? '' : 's'} (local copies kept in data/images/square)`)
      } catch (error: any) {
        problems.push(`Deleting images failed: ${error?.statusMessage ?? 'unknown error'}. The item itself was updated.`)
      }
    }

    // 4. Refresh the local snapshot from Square.
    await refreshSnapshotItem(id, deletable)
    // Uploaded pictures now live in Square, so the local copies are cleared (they would show up again as new pictures).
    await removeBookishUploads(id, uploads.map(upload => upload.oldId).filter(isUploadId))
    await markBookishUpdated(id)
    return { updated: true, steps: done, problems }
  } catch (error: any) {
    // Say how far it got, so a half-finished update is never a mystery.
    const data = { ...(error?.data ?? {}), completedSteps: done }
    throw createError({ statusCode: error?.statusCode ?? 500, statusMessage: error?.statusMessage ?? 'Update failed', data })
  } finally {
    sending = false
  }
})
