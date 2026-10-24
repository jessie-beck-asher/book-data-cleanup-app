// Builds the single-item update for one book: the diff the owner reviews and the exact object that would be sent.
// Building a plan only reads (local files plus one GET of the live item). Sending is in the send route.
import { readFile } from 'node:fs/promises'
import { imageNameFor, looksSprayed } from '../../shared/imageNames.ts'

export interface PlanRow { field: string, before: string, after: string, changed: boolean }

interface Upload { key: string, label: string, isbn: string, slot: string, bytes: number, width: number, name: string }

export interface UpdatePlan {
  itemId: string
  environment: string
  blockers: string[]
  warnings: string[]
  rows: PlanRow[]
  // Internal, used by the send route; not returned to the browser.
  internal?: { item: any, original: any, uploads: Upload[], deleteImageIds: string[], renames: { imageId: string, name: string }[], caption: string }
}

const DEFAULT_CROP = { zoom: 1, cx: 0.5, cy: 0.5 }
const sameCrop = (a: SavedCrop, b: SavedCrop) => a.zoom === b.zoom && a.cx === b.cx && a.cy === b.cy
const cropFor = (edit: SavedEdit, key: string): SavedCrop => edit.crops[key] ?? DEFAULT_CROP

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// Square's description_html: Square shows each <p> on its own line with no gap, so a blank line is an empty paragraph between them.
// Single line breaks are <br>.
export function plainToHtml(text: string) {
  return tidyText(text).split(/\n{2,}/).filter(Boolean).map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('<p><br></p>')
}

function money(value: { amount?: number, currency?: string } | undefined) {
  return value && typeof value.amount === 'number' ? `${(value.amount / 100).toFixed(2)} ${value.currency ?? ''}`.trim() : '(none)'
}
const list = (values: string[]) => values.length ? values.join(', ') : '(none)'

// Everything on a variation that this update must leave alone.
function untouchedVariationData(variation: any) {
  const data = structuredClone(variation?.item_variation_data ?? {})
  delete data.name
  delete data.item_option_values
  delete data.image_ids
  // The ISBN may move from SKU to GTIN (see the variation step), so those two are compared separately.
  delete data.sku
  delete data.upc
  return JSON.stringify(data)
}

async function findCategoryIds(names: string[], known: Map<string, string>) {
  const missing = names.filter(name => !known.has(name))
  if (missing.length) {
    let cursor: string | undefined
    do {
      const page = await squareGet(`/v2/catalog/list?types=CATEGORY${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      for (const object of page?.objects ?? []) if (object.category_data?.name) known.set(object.category_data.name, object.id)
      cursor = page?.cursor
    } while (cursor)
  }
  return known
}

export async function makePlan(itemId: string): Promise<UpdatePlan> {
  const environment = currentEnvironmentName()
  const plan: UpdatePlan = { itemId, environment, blockers: [], warnings: [], rows: [] }

  const snapshot = await readSnapshot()
  const snapshotItem = snapshot?.items.find(candidate => candidate.id === itemId)
  const isbns = snapshotItem ? getItemIsbns(snapshotItem) : null
  if (!snapshot || !snapshotItem || isbns?.size !== 1) {
    plan.blockers.push('This book is not in the local snapshot.')
    return plan
  }
  const isbn = [...isbns][0]!

  const edit = (await readEdits())[itemId]
  if (!edit) {
    plan.blockers.push('No edits are saved for this book yet. Change something first.')
    return plan
  }

  // Version check: the live item must be exactly what was pulled.
  const live = await squareGet(`/v2/catalog/object/${itemId}?include_related_objects=true`)
  const item = structuredClone(live?.object)
  if (!item || item.is_deleted) {
    plan.blockers.push('The item no longer exists in Square.')
    return plan
  }
  if (String(item.version) !== String(snapshotItem.version)) {
    plan.blockers.push('This item changed in Square after the snapshot was pulled. Pull the catalog again before updating.')
  }
  const variationVersions = (variations: any[]) => (variations ?? []).map(variation => `${variation.id}:${variation.version}`).join('|')
  if (variationVersions(item.item_data?.variations) !== variationVersions(snapshotItem.item_data?.variations)) {
    plan.blockers.push('The variation changed in Square after the snapshot was pulled. Pull the catalog again before updating.')
  }

  const data = item.item_data
  const original = structuredClone(item)
  const relatedById = new Map<string, any>([...(snapshot.relatedObjects ?? []), ...(live?.related_objects ?? [])].map(object => [object.id, object]))
  const nameOf = (id: string) => relatedById.get(id)?.category_data?.name as string | undefined

  // ---- Title
  const title = edit.title.trim()
  if (!title) plan.blockers.push('The title is empty.')
  plan.rows.push({ field: 'Title', before: data.name ?? '', after: title, changed: title !== (data.name ?? '') })
  if (title && title !== data.name) data.name = title

  // ---- Description
  const currentText = tidyText(data.description_plaintext ?? data.description ?? '')
  const newText = tidyText(edit.description)
  plan.rows.push({ field: 'Description', before: currentText || '(none)', after: newText || '(none)', changed: currentText !== newText })
  if (currentText !== newText) {
    data.description_html = plainToHtml(newText)
    delete data.description
    delete data.description_plaintext
  }

  // ---- Categories
  const currentIds: string[] = (data.categories ?? []).map((category: { id: string }) => category.id)
  const currentNames = currentIds.map(id => nameOf(id) ?? id)
  const known = new Map<string, string>()
  for (const object of relatedById.values()) if (object.type === 'CATEGORY' && object.category_data?.name) known.set(object.category_data.name, object.id)
  await findCategoryIds(edit.categories, known)
  const missingCategories = edit.categories.filter(name => !known.has(name))
  if (missingCategories.length) plan.blockers.push(`Square has no category named: ${missingCategories.join(', ')}. Create it in Square first; this app does not create categories.`)
  const newIds = edit.categories.map(name => known.get(name)).filter((id): id is string => !!id)
  const categoriesChanged = newIds.length !== currentIds.length || newIds.some(id => !currentIds.includes(id))
  plan.rows.push({ field: 'Categories', before: list(currentNames), after: list(edit.categories), changed: categoriesChanged })
  if (categoriesChanged && !missingCategories.length) {
    data.categories = newIds.map(id => (data.categories ?? []).find((category: { id: string }) => category.id === id) ?? { id })
    const fallback = known.get('Books') && newIds.includes(known.get('Books')!) ? known.get('Books')! : newIds[0]
    if (data.reporting_category?.id && !newIds.includes(data.reporting_category.id) && fallback) data.reporting_category = { id: fallback }
    if (data.category_id && !newIds.includes(data.category_id) && fallback) data.category_id = fallback
  }

  // ---- Variation
  const variations: any[] = data.variations ?? []
  if (variations.length !== 1) {
    plan.blockers.push(`This item has ${variations.length} variations; only single-variation books are handled.`)
  }
  const variation = variations[0]
  const variationData = variation?.item_variation_data ?? {}
  const optionCount = (variationData.item_option_values ?? []).length
  const wantsRegular = edit.changeVariation && (variationData.name !== 'Regular' || optionCount > 0)
  plan.rows.push({
    field: 'Variation',
    before: `${variationData.name || '(no name)'}${optionCount ? ` (${optionCount} item options)` : ''}`,
    after: wantsRegular ? 'Regular (no item options)' : `${variationData.name || '(no name)'} (not changed)`,
    changed: wantsRegular
  })
  // With the variation gone, a book's ISBN belongs in the GTIN field: move it from the SKU when the GTIN is empty.
  const isbnInSku = toIsbn13(variationData.sku)
  const moveSkuToGtin = wantsRegular && !!isbnInSku && !String(variationData.upc ?? '').trim()
  const identifiers = (sku: string | undefined, upc: string | undefined) => `${sku || '(none)'} / ${upc || '(none)'}`
  const identifiersBefore = identifiers(variationData.sku, variationData.upc)
  if (wantsRegular) {
    variationData.name = 'Regular'
    delete variationData.item_option_values
    delete data.item_options
  }
  if (moveSkuToGtin) {
    variationData.upc = isbnInSku
    delete variationData.sku
  }

  // ---- Images
  const uploads: Upload[] = []
  const deleteImageIds: string[] = []
  const currentImageIds: string[] = [...(data.image_ids ?? [])]
  const uploadedNames = (await listUploaded(isbn)).map(upload => `upload:${upload.name}`)
  const hasIsbndbCover = !!(await readOriginalInfo(isbn))
  const available = new Set([...currentImageIds.map(id => `square:${id}`), ...(hasIsbndbCover ? [`isbndb:${isbn}`] : []), ...uploadedNames])
  const included = new Set(edit.includedImages.filter(key => available.has(key)))

  // Names given to images in Square. An image already named "sprayed-edges" starts out marked.
  const sprayed = new Set(edit.sprayedEdges ?? currentImageIds.filter(id => looksSprayed(relatedById.get(id)?.image_data?.name)).map(id => `square:${id}`))
  const nameForKey = (key: string) => imageNameFor(title, sprayed.has(key))
  const renames: { imageId: string, name: string }[] = []
  const usedElsewhere = new Set<string>()
  for (const other of snapshot.items) {
    if (other.id === itemId) continue
    for (const id of other.item_data?.image_ids ?? []) usedElsewhere.add(id)
  }
  const finalIds: string[] = []
  // Which final image ID (or #new slot) belongs to which image key, so the primary one can be moved to the front.
  const finalByKey = new Map<string, string>()
  const imageLines: string[] = []

  async function prepareUpload(key: string, label: string) {
    const slot = `#new-${uploads.length + 1}`
    const file = optimizedPath(isbn, key)
    let meta: { crop?: SavedCrop, warnings?: string[], width?: number } | null = null
    let size = 0
    try {
      meta = JSON.parse(await readFile(`${file}.json`, 'utf8'))
      size = (await readFile(file)).length
    } catch {
      plan.blockers.push(`"${label}" has not been optimized yet. Press Optimize first.`)
      return null
    }
    if (!meta?.crop || !sameCrop(meta.crop, cropFor(edit, key))) {
      plan.blockers.push(`"${label}" was optimized with a different crop. Press Optimize again.`)
      return null
    }
    for (const warning of meta.warnings ?? []) plan.warnings.push(`${label}: ${warning}`)
    if (size > MAX_BYTES) plan.blockers.push(`"${label}" is ${Math.round(size / 1024)} KB, over the 500 KB limit.`)
    uploads.push({ key, label, isbn, slot, bytes: size, width: meta.width ?? 0, name: nameForKey(key) })
    return { slot, size, width: meta.width ?? 0 }
  }

  for (const id of currentImageIds) {
    const key = `square:${id}`
    const label = `Current Square image ${id}`
    if (!included.has(key)) {
      deleteImageIds.push(id)
      imageLines.push(`Remove ${id} from the item (and delete it from Square)`)
    } else if (!sameCrop(cropFor(edit, key), DEFAULT_CROP)) {
      const prepared = await prepareUpload(key, label)
      deleteImageIds.push(id)
      if (prepared) {
        finalIds.push(prepared.slot)
        finalByKey.set(key, prepared.slot)
        imageLines.push(`Replace ${id} with your cropped, optimized version named ${nameForKey(key)} (${prepared.width}×${prepared.width}, ${Math.round(prepared.size / 1024)} KB)`)
      }
    } else {
      finalIds.push(id)
      finalByKey.set(key, id)
      const currentName: string = relatedById.get(id)?.image_data?.name ?? ''
      if (currentName === nameForKey(key)) imageLines.push(`Keep ${id} as it is`)
      else if (usedElsewhere.has(id)) {
        imageLines.push(`Keep ${id} as it is (not renamed: another Square item uses it)`)
        plan.warnings.push(`Image ${id} is also used by another Square item, so it was not renamed.`)
      } else {
        renames.push({ imageId: id, name: nameForKey(key) })
        imageLines.push(`Rename ${id} from "${currentName || '(no name)'}" to "${nameForKey(key)}"`)
      }
    }
  }
  for (const key of [...(hasIsbndbCover ? [`isbndb:${isbn}`] : []), ...uploadedNames]) {
    if (!included.has(key)) continue
    const label = key.startsWith('isbndb:') ? 'ISBNdb cover' : 'Your upload'
    const prepared = await prepareUpload(key, label)
    if (prepared) {
      finalIds.push(prepared.slot)
      finalByKey.set(key, prepared.slot)
      imageLines.push(`Add ${label} named ${nameForKey(key)} (${prepared.width}×${prepared.width}, ${Math.round(prepared.size / 1024)} KB)`)
    }
  }

  // An image used by another item, or already removed, is detached here but never deleted from Square.
  const shared = new Set<string>()
  for (const other of snapshot.items) {
    if (other.id === itemId) continue
    const ids: string[] = [...(other.item_data?.image_ids ?? []), ...(other.item_data?.variations ?? []).flatMap((entry: any) => entry.item_variation_data?.image_ids ?? [])]
    for (const id of ids) if (deleteImageIds.includes(id)) shared.add(id)
  }
  for (const id of shared) plan.warnings.push(`Image ${id} is also used by another Square item, so it is removed from this item but not deleted from Square.`)
  const reallyDelete = deleteImageIds.filter(id => !shared.has(id))

  // The first image is the primary one. The owner's pick goes first; the rest keep their order.
  const primaryId = edit.primaryImage && included.has(edit.primaryImage) ? finalByKey.get(edit.primaryImage) : undefined
  if (primaryId && finalIds[0] !== primaryId) {
    finalIds.splice(finalIds.indexOf(primaryId), 1)
    finalIds.unshift(primaryId)
  }
  if (finalIds.length && finalIds[0] !== currentImageIds[0]) {
    const firstKey = [...finalByKey].find(([, id]) => id === finalIds[0])?.[0] ?? ''
    imageLines.push(`Primary (first) image is now ${firstKey.startsWith('square:') ? firstKey.slice(7) : firstKey.startsWith('isbndb:') ? 'the ISBNdb cover' : 'your upload'}`)
  }

  const finalNames = [...finalByKey].filter(([, id]) => finalIds.includes(id)).map(([key]) => nameForKey(key))
  if (new Set(finalNames).size !== finalNames.length) plan.blockers.push('Two images would get the same name. Mark one of them as the sprayed-edges image.')

  const imagesChanged = imageLines.some(line => !line.startsWith('Keep'))
  plan.rows.push({ field: 'Images', before: list(currentImageIds), after: imageLines.join('\n') || '(none)', changed: imagesChanged })
  if (imagesChanged) {
    data.image_ids = finalIds
    if (variationData.image_ids) {
      const remaining = variationData.image_ids.filter((id: string) => !deleteImageIds.includes(id))
      if (remaining.length !== variationData.image_ids.length) plan.warnings.push('An image used by the variation itself is being removed from it too.')
      variationData.image_ids = remaining
    }
    if (!finalIds.length) plan.warnings.push('The item will have no images.')
  }

  // ---- Everything that must not change
  const originalVariation = original.item_data.variations[0]
  const identifiersUnexpected = variation && (moveSkuToGtin
    ? variation.item_variation_data.upc !== isbnInSku || variation.item_variation_data.sku !== undefined
    : variation.item_variation_data.sku !== originalVariation.item_variation_data.sku || variation.item_variation_data.upc !== originalVariation.item_variation_data.upc)
  if (identifiersUnexpected || (variation && untouchedVariationData(variation) !== untouchedVariationData(originalVariation))) {
    plan.blockers.push('Internal check failed: something other than the intended fields changed on the variation.')
  }
  plan.rows.push({ field: 'Price', before: money(variationData.price_money), after: money(variationData.price_money), changed: false })
  plan.rows.push({
    field: 'SKU / GTIN',
    before: identifiersBefore,
    after: identifiers(variationData.sku, variationData.upc),
    changed: moveSkuToGtin
  })
  plan.rows.push({ field: 'Inventory tracking and everything else on the variation', before: 'unchanged', after: 'unchanged', changed: false })

  if (!plan.rows.some(row => row.changed)) plan.warnings.push('Nothing would change in Square.')
  // Slots like #new-1 in image_ids are replaced with real image IDs by the send route.
  plan.internal = { item, original, uploads, deleteImageIds: reallyDelete, renames, caption: data.name ?? '' }
  return plan
}
