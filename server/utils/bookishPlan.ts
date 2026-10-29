// Builds the single-item update for one bookish (non-ISBN) item: the diff the owner reviews and the exact object that would be sent.
// Building a plan only reads (the local snapshot, local image files and one GET of the live item). Sending is in the send route.
import sharp from 'sharp'
import { imageCaptionFor } from '../../shared/imageNames.ts'

export interface BookishEdit {
  title: string
  description: string
  categoryIds: string[]
  variationNames: Record<string, string>
  images: {
    removedIds: string[]
    // Pictures uploaded on this computer that go to Square with the update.
    uploadIds: string[]
    primaryId: string | null
    names: Record<string, string>
    // Alt text (Square's image caption). An image with none keeps the old behaviour: its name with spaces.
    alts: Record<string, string>
    crops: Record<string, { zoom: number, cx: number, cy: number }>
  }
}

export interface BookishPlanRow { field: string, before: string, after: string, changed: boolean }

interface BookishUpload { oldId: string, slot: string, name: string, caption: string, label: string, buffer: Buffer }

export interface BookishPlan {
  itemId: string
  environment: string
  blockers: string[]
  warnings: string[]
  rows: BookishPlanRow[]
  // Internal, used by the send route; not returned to the browser.
  internal?: { item: any, original: any, uploads: BookishUpload[], deleteImageIds: string[], renames: { imageId: string, name: string, caption: string }[] }
}

const isString = (value: unknown): value is string => typeof value === 'string'
const isId = (value: unknown): value is string => isString(value) && /^[A-Za-z0-9_-]{1,64}$/.test(value)
const IMAGE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DEFAULT_CROP = { zoom: 1, cx: 0.5, cy: 0.5 }

// The body of a plan or send request, checked field by field. Anything unexpected is a 400.
export function parseBookishEdit(body: any): BookishEdit {
  const bad = (what: string) => createError({ statusCode: 400, statusMessage: `Bad edit: ${what}` })
  if (!body || !isString(body.title) || !isString(body.description) || body.title.length > 512 || body.description.length > 20000) throw bad('title or description')
  if (!Array.isArray(body.categoryIds) || body.categoryIds.length > 100 || !body.categoryIds.every(isId)) throw bad('categories')
  const variationNames: Record<string, string> = {}
  for (const [id, name] of Object.entries(body.variationNames ?? {})) {
    if (!isId(id) || !isString(name) || name.length > 255) throw bad('variation names')
    variationNames[id] = name
  }
  const images = body.images ?? {}
  if (!Array.isArray(images.removedIds ?? []) || !(images.removedIds ?? []).every(isId)) throw bad('removed images')
  if (images.primaryId != null && !isId(images.primaryId)) throw bad('primary image')
  if (!Array.isArray(images.uploadIds ?? []) || !(images.uploadIds ?? []).every(isUploadId)) throw bad('uploads')
  const names: Record<string, string> = {}
  for (const [id, name] of Object.entries(images.names ?? {})) {
    if (!isId(id) || !isString(name) || name.length > 150) throw bad('image names')
    names[id] = name
  }
  const alts: Record<string, string> = {}
  for (const [id, alt] of Object.entries(images.alts ?? {})) {
    if (!isId(id) || !isString(alt) || alt.length > 500) throw bad('alt text')
    if (alt.trim()) alts[id] = alt.trim()
  }
  const crops: BookishEdit['images']['crops'] = {}
  for (const [id, crop] of Object.entries<any>(images.crops ?? {})) {
    const ok = typeof crop?.zoom === 'number' && typeof crop?.cx === 'number' && typeof crop?.cy === 'number'
      && [crop.zoom, crop.cx, crop.cy].every(Number.isFinite) && crop.zoom >= 0.5 && crop.zoom <= 4 && Math.abs(crop.cx) <= 5 && Math.abs(crop.cy) <= 5
    if (!isId(id) || !ok) throw bad('crops')
    crops[id] = { zoom: crop.zoom, cx: crop.cx, cy: crop.cy }
  }
  return {
    title: body.title,
    description: body.description,
    categoryIds: body.categoryIds,
    variationNames,
    images: { removedIds: images.removedIds ?? [], uploadIds: images.uploadIds ?? [], primaryId: images.primaryId ?? null, names, alts, crops }
  }
}

// Everything on a variation that this update must leave alone (its name, options and images are the parts that may change).
function untouchedVariationData(variation: any) {
  const data = structuredClone(variation?.item_variation_data ?? {})
  delete data.name
  delete data.item_option_values
  delete data.image_ids
  return JSON.stringify(data)
}

const money = (value: { amount?: number, currency?: string } | undefined) =>
  value && typeof value.amount === 'number' ? `${(value.amount / 100).toFixed(2)} ${value.currency ?? ''}`.trim() : '(none)'
const list = (values: string[]) => values.length ? values.join(', ') : '(none)'
const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`

export async function makeBookishPlan(itemId: string, edit: BookishEdit): Promise<BookishPlan> {
  const environment = currentEnvironmentName()
  const plan: BookishPlan = { itemId, environment, blockers: [], warnings: [], rows: [] }

  const snapshot = await readSnapshot()
  const snapshotItem = snapshot?.items.find(candidate => candidate.id === itemId)
  if (!snapshot || !snapshotItem || getItemIsbns(snapshotItem).size !== 0) {
    plan.blockers.push('This is not a bookish item in the local snapshot.')
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
    plan.blockers.push('This item changed in Square after the snapshot was pulled. Pull this item again before updating.')
  }
  const variationVersions = (variations: any[]) => (variations ?? []).map(variation => `${variation.id}:${variation.version}`).join('|')
  if (variationVersions(item.item_data?.variations) !== variationVersions(snapshotItem.item_data?.variations)) {
    plan.blockers.push('A variation changed in Square after the snapshot was pulled. Pull this item again before updating.')
  }
  const data = item.item_data
  const original = structuredClone(item)
  const relatedById = new Map<string, any>([...(snapshot.relatedObjects ?? []), ...(live?.related_objects ?? [])].map(object => [object.id, object]))

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
  const categories = new Map<string, { name: string, parentId: string | null }>()
  let cursor: string | undefined
  do {
    const page = await squareGet(`/v2/catalog/list?types=CATEGORY${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    for (const object of page?.objects ?? []) {
      if (object.category_data?.name) categories.set(object.id, { name: object.category_data.name, parentId: object.category_data.is_top_level ? null : object.category_data.parent_category?.id ?? null })
    }
    cursor = page?.cursor
  } while (cursor)
  const currentIds: string[] = (data.categories ?? []).map((category: { id: string }) => category.id)
  const unknown = edit.categoryIds.filter(id => !categories.has(id))
  if (unknown.length) plan.blockers.push(`Square has no category with ID ${unknown.join(', ')}.`)
  const newIds = [...new Set(edit.categoryIds.filter(id => categories.has(id)))]
  const catName = (id: string) => categories.get(id)?.name ?? relatedById.get(id)?.category_data?.name ?? id
  const categoriesChanged = newIds.length !== currentIds.length || newIds.some(id => !currentIds.includes(id))
  plan.rows.push({ field: 'Categories', before: list(currentIds.map(catName)), after: list(newIds.map(catName)), changed: categoriesChanged })
  if (categoriesChanged && !unknown.length) {
    data.categories = newIds.map(id => (data.categories ?? []).find((category: { id: string }) => category.id === id) ?? { id })
    const fallback = newIds[0]
    if (data.reporting_category?.id && !newIds.includes(data.reporting_category.id)) {
      if (fallback) data.reporting_category = { id: fallback }
      else plan.blockers.push('The item would be left with no category, but it has a reporting category. Pick at least one category.')
    }
    if (data.category_id && !newIds.includes(data.category_id) && fallback) data.category_id = fallback
  }

  // ---- Variation names (only variations with no item options)
  const variations: any[] = data.variations ?? []
  const nameLines: string[] = []
  for (const variation of variations) {
    const variationData = variation.item_variation_data ?? {}
    const wanted = edit.variationNames[variation.id]
    if (wanted === undefined || wanted === (variationData.name ?? '')) continue
    if ((variationData.item_option_values ?? []).length) {
      plan.blockers.push(`"${variationData.name}" gets its name from item options, so it cannot be renamed here.`)
      continue
    }
    if (!wanted.trim()) {
      plan.blockers.push('A variation name is empty.')
      continue
    }
    nameLines.push(`${variationData.name || '(no name)'} → ${wanted.trim()}`)
    variationData.name = wanted.trim()
  }
  plan.rows.push({
    field: 'Variation names',
    before: list(variations.map(variation => original.item_data.variations.find((entry: any) => entry.id === variation.id)?.item_variation_data?.name || '(no name)')),
    after: nameLines.join('\n') || '(not changed)',
    changed: nameLines.length > 0
  })

  // ---- Images
  const uploads: BookishUpload[] = []
  const renames: { imageId: string, name: string, caption: string }[] = []
  const currentImageIds: string[] = [...(data.image_ids ?? [])]
  const removed = new Set(edit.images.removedIds)
  for (const id of removed) if (!currentImageIds.includes(id)) plan.blockers.push(`Image ${id} is not on this item, so it cannot be removed.`)
  const usedElsewhere = new Set<string>()
  for (const other of snapshot.items) {
    if (other.id === itemId) continue
    for (const id of [...(other.item_data?.image_ids ?? []), ...(other.item_data?.variations ?? []).flatMap((entry: any) => entry.item_variation_data?.image_ids ?? [])]) usedElsewhere.add(id)
  }
  const imageLines: string[] = []
  const finalIds: string[] = []
  const replacedBy = new Map<string, string>()
  const deleteImageIds: string[] = []
  const keptNames: string[] = []

  for (const id of currentImageIds) {
    if (removed.has(id)) {
      if (usedElsewhere.has(id)) {
        imageLines.push(`Remove ${id} from this item (another Square item also uses it, so it is not deleted)`)
      } else {
        deleteImageIds.push(id)
        imageLines.push(`Remove ${id} from the item and delete it from Square`)
      }
      continue
    }
    if (usedElsewhere.has(id)) {
      finalIds.push(id)
      imageLines.push(`Keep ${id} as it is (another Square item also uses it)`)
      plan.warnings.push(`Image ${id} is also used by another Square item, so it was left alone.`)
      continue
    }
    const name = edit.images.names[id] ?? ''
    if (!IMAGE_NAME.test(name)) {
      plan.blockers.push(`Image ${id} needs a name (lowercase letters, numbers and dashes).`)
      continue
    }
    keptNames.push(name)
    const crop = edit.images.crops[id] ?? DEFAULT_CROP
    const cropped = crop.zoom !== 1 || crop.cx !== 0.5 || crop.cy !== 0.5
    let source: Buffer
    try {
      source = await loadSquareImage(id)
    } catch {
      plan.blockers.push(`Image ${id} could not be read.`)
      continue
    }
    const meta = await sharp(source).metadata()
    const longest = Math.max(meta.width ?? 0, meta.height ?? 0)
    // A picture you did not crop that already meets the limits is kept and only renamed. Anything else is replaced by the optimized JPEG.
    if (!cropped && source.length <= MAX_BYTES && longest >= MIN_SIDE && longest <= MAX_SIDE) {
      finalIds.push(id)
      const currentName: string = relatedById.get(id)?.image_data?.name ?? ''
      const currentCaption: string = relatedById.get(id)?.image_data?.caption ?? ''
      const caption = edit.images.alts[id] ?? (currentName === name ? currentCaption : imageCaptionFor(name))
      const parts = [currentName !== name ? `rename it from "${currentName || '(no name)'}" to "${name}"` : '', caption !== currentCaption ? `set its alt text to "${caption}"` : ''].filter(Boolean)
      if (!parts.length) imageLines.push(`Keep ${id} as it is (already within the size limits)`)
      else {
        renames.push({ imageId: id, name, caption })
        imageLines.push(`Keep ${id}, ${parts.join(' and ')} (already within the size limits)`)
      }
      continue
    }
    const result = await optimizeImage(source, crop)
    for (const warning of result.warnings) plan.warnings.push(`${name}: ${warning}`)
    if (result.bytes > MAX_BYTES) plan.blockers.push(`"${name}" is ${kb(result.bytes)}, over the 500 KB limit.`)
    const slot = `#new-${uploads.length + 1}`
    const caption = edit.images.alts[id] ?? imageCaptionFor(name)
    uploads.push({ oldId: id, slot, name, caption, label: name, buffer: result.buffer })
    replacedBy.set(id, slot)
    finalIds.push(slot)
    deleteImageIds.push(id)
    imageLines.push(`Replace ${id} with an optimized version named ${name}${edit.images.alts[id] ? `, alt text "${edit.images.alts[id]}"` : ''} (${result.width}×${result.height}, ${kb(result.bytes)}, was ${kb(source.length)})`)
  }
  // Pictures uploaded here: always optimized and added as new images, after the ones already on the item.
  for (const uploadId of edit.images.uploadIds) {
    if (removed.has(uploadId)) continue
    const name = edit.images.names[uploadId] ?? ''
    if (!IMAGE_NAME.test(name)) {
      plan.blockers.push(`Uploaded image ${uploadId} needs a name (lowercase letters, numbers and dashes).`)
      continue
    }
    keptNames.push(name)
    let source: Buffer
    try {
      source = await readBookishUpload(itemId, uploadId)
    } catch {
      plan.blockers.push(`Uploaded image ${uploadId} could not be read.`)
      continue
    }
    const result = await optimizeImage(source, edit.images.crops[uploadId] ?? DEFAULT_CROP)
    for (const warning of result.warnings) plan.warnings.push(`${name}: ${warning}`)
    if (result.bytes > MAX_BYTES) plan.blockers.push(`"${name}" is ${kb(result.bytes)}, over the 500 KB limit.`)
    const slot = `#new-${uploads.length + 1}`
    const caption = edit.images.alts[uploadId] ?? imageCaptionFor(name)
    uploads.push({ oldId: uploadId, slot, name, caption, label: name, buffer: result.buffer })
    replacedBy.set(uploadId, slot)
    finalIds.push(slot)
    imageLines.push(`Add your uploaded image named ${name}${edit.images.alts[uploadId] ? `, alt text "${edit.images.alts[uploadId]}"` : ''} (${result.width}×${result.height}, ${kb(result.bytes)}, was ${kb(source.length)})`)
  }
  if (new Set(keptNames).size !== keptNames.length) plan.blockers.push('Two images would get the same name.')

  // The first image is the primary one.
  const primarySlot = edit.images.primaryId && !removed.has(edit.images.primaryId) ? (replacedBy.get(edit.images.primaryId) ?? edit.images.primaryId) : undefined
  if (primarySlot && finalIds.includes(primarySlot) && finalIds[0] !== primarySlot) {
    finalIds.splice(finalIds.indexOf(primarySlot), 1)
    finalIds.unshift(primarySlot)
  }
  const firstOld = finalIds[0] && [...replacedBy].find(([, slot]) => slot === finalIds[0])?.[0] || finalIds[0]
  if (firstOld && firstOld !== currentImageIds[0]) imageLines.push(`Primary (first) image is now ${firstOld}`)

  const imagesChanged = imageLines.some(line => !line.startsWith('Keep ') || line.includes('rename') || line.includes('alt text'))
    || finalIds.join('|') !== currentImageIds.join('|')
    || imageLines.some(line => line.startsWith('Add '))
  plan.rows.push({ field: 'Images', before: list(currentImageIds), after: imageLines.join('\n') || '(none)', changed: imagesChanged })
  if (imagesChanged) {
    data.image_ids = finalIds
    // Variations that pointed at a replaced image point at its new version; ones that pointed at a removed image lose the link.
    for (const variation of variations) {
      const variationData = variation.item_variation_data ?? {}
      if (!variationData.image_ids) continue
      const next = variationData.image_ids.filter((id: string) => !removed.has(id)).map((id: string) => replacedBy.get(id) ?? id)
      if (next.length < variationData.image_ids.length) plan.warnings.push(`"${variationData.name || variation.id}" loses a picture that was removed.`)
      variationData.image_ids = next
    }
    if (!finalIds.length) plan.warnings.push('The item will have no images.')
  }

  // ---- Everything that must not change
  const originalVariations = new Map<string, any>((original.item_data.variations ?? []).map((variation: any) => [variation.id, variation]))
  for (const variation of variations) {
    const before = originalVariations.get(variation.id)
    if (!before || untouchedVariationData(variation) !== untouchedVariationData(before)) {
      plan.blockers.push('Internal check failed: something other than the intended fields changed on a variation.')
      break
    }
  }
  plan.rows.push({ field: 'Prices', before: list(variations.map(variation => money(variation.item_variation_data?.price_money))), after: 'unchanged', changed: false })
  plan.rows.push({ field: 'SKUs, GTINs, stock tracking and everything else', before: 'unchanged', after: 'unchanged', changed: false })

  if (!plan.rows.some(row => row.changed)) plan.warnings.push('Nothing would change in Square.')
  // Slots like #new-1 in image_ids are replaced with real image IDs by the send route.
  plan.internal = { item, original, uploads, deleteImageIds, renames }
  return plan
}
