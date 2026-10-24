// Updates ONE item in Square (sandbox only for now): uploads new images, upserts the item, then deletes removed images.
import { readFile } from 'node:fs/promises'

let sending = false

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const body = await readBody<{ confirm?: boolean }>(event).catch(() => null)
  if (body?.confirm !== true) throw createError({ statusCode: 400, statusMessage: 'The update needs your confirmation' })
  await assertWritesEnabledFor(id)
  if (sending) throw createError({ statusCode: 409, statusMessage: 'An update is already running' })
  sending = true

  const done: string[] = []
  try {
    // Rebuilt from scratch right now, so the version check is against Square as it is at this moment.
    const plan = await makePlan(id)
    if (plan.blockers.length || !plan.internal) throw createError({ statusCode: 409, statusMessage: 'This update is blocked', data: { blockers: plan.blockers } })
    if (!plan.rows.some(row => row.changed)) throw createError({ statusCode: 409, statusMessage: 'Nothing would change' })
    const { item, original, uploads, deleteImageIds, renames, caption } = plan.internal

    // 0. Keep Square's current copy of the item, so this update can be reverted. If this fails, nothing is sent.
    await saveBackup(id, original, 'before-update')
    done.push('Saved a backup of the item as it was')

    // 1. Upload new images, unattached (so the item's version does not change yet).
    const newIds: Record<string, string> = {}
    for (const upload of uploads) {
      const form = new FormData()
      form.append('request', new Blob([JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        image: { type: 'IMAGE', id: '#image', image_data: { caption, name: upload.name } }
      })], { type: 'application/json' }))
      form.append('file', new Blob([await readFile(optimizedPath(upload.isbn, upload.key))], { type: 'image/jpeg' }), `${upload.name}.jpg`)
      const result = await squareWriteForm('/v2/catalog/images', form)
      newIds[upload.slot] = result.image.id
      done.push(`Uploaded ${upload.label}`)
    }
    item.item_data.image_ids = (item.item_data.image_ids ?? []).map((imageId: string) => newIds[imageId] ?? imageId)

    // 2. Update the item. The object carries the version read a moment ago, so Square rejects it if anything changed.
    await squareWriteJson('/v2/catalog/object', { idempotency_key: crypto.randomUUID(), object: item })
    done.push('Updated the item')

    // 2b. Rename images that stay on the item. This changes only the image's own name, in place. A failure does not undo the update.
    const renameProblems: string[] = []
    for (const rename of renames) {
      try {
        const current = await squareGet(`/v2/catalog/object/${rename.imageId}`)
        const object = current.object
        object.image_data = { ...object.image_data, name: rename.name }
        await squareWriteJson('/v2/catalog/object', { idempotency_key: crypto.randomUUID(), object })
        done.push(`Renamed image to ${rename.name}`)
      } catch (error: any) {
        renameProblems.push(`Could not rename image ${rename.imageId} to ${rename.name}: ${error?.statusMessage ?? 'unknown error'}. The rest of the update went through.`)
      }
    }

    // 3. Delete images that were removed. Every one is saved locally first; a failure here does not undo the update.
    const deleteProblems: string[] = [...renameProblems]
    const deletable: string[] = []
    for (const imageId of deleteImageIds) {
      try {
        await loadSquareImage(imageId)
        deletable.push(imageId)
      } catch {
        deleteProblems.push(`Image ${imageId} was not deleted because a local copy could not be saved first.`)
      }
    }
    if (deletable.length) {
      try {
        await squareWriteJson('/v2/catalog/batch-delete', { object_ids: deletable })
        done.push(`Deleted ${deletable.length} image${deletable.length === 1 ? '' : 's'} (local copies kept in data/images/square)`)
      } catch (error: any) {
        deleteProblems.push(`Deleting images failed: ${error?.statusMessage ?? 'unknown error'}. The item itself was updated.`)
      }
    }

    // 4. Refresh the local snapshot from Square and record that this book was updated.
    await refreshSnapshotItem(id, deletable)
    await markUpdated(id)
    return { updated: true, steps: done, problems: deleteProblems }
  } catch (error: any) {
    // Say how far it got, so a half-finished update is never a mystery.
    const data = { ...(error?.data ?? {}), completedSteps: done }
    throw createError({ statusCode: error?.statusCode ?? 500, statusMessage: error?.statusMessage ?? 'Update failed', data })
  } finally {
    sending = false
  }
})
