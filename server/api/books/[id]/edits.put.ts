// Saves the owner's edits for one book to a local file. Does not touch Square.
const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
const isTextList = (value: unknown, max: number): value is string[] =>
  Array.isArray(value) && value.length <= max && value.every(entry => isText(entry, 200))

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const snapshot = await readSnapshot()
  const item = snapshot?.items.find(candidate => candidate.id === id)
  if (!item || getItemIsbns(item).size !== 1) throw createError({ statusCode: 404, statusMessage: 'Book not found' })

  const body = await readBody<any>(event)
  const crops: Record<string, SavedCrop> = {}
  if (body && typeof body.crops === 'object' && body.crops) {
    for (const [key, crop] of Object.entries<any>(body.crops)) {
      if (!isText(key, 200) || typeof crop?.zoom !== 'number' || typeof crop?.cx !== 'number' || typeof crop?.cy !== 'number') continue
      if (![crop.zoom, crop.cx, crop.cy].every(Number.isFinite)) continue
      crops[key] = { zoom: crop.zoom, cx: crop.cx, cy: crop.cy }
    }
  }

  const imageNameExtras: Record<string, string> = {}
  if (body && typeof body.imageNameExtras === 'object' && body.imageNameExtras) {
    for (const [key, text] of Object.entries<any>(body.imageNameExtras)) {
      if (isText(key, 200) && isText(text, 60) && text.trim()) imageNameExtras[key] = text.trim()
    }
  }

  if (!isText(body?.title, 1000) || !isText(body?.description, 100000) || !isTextList(body?.categories, 100)
    || typeof body?.changeVariation !== 'boolean' || !isTextList(body?.includedImages, 100)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad edit values' })
  }

  const saved = await saveEdit(id, {
    title: body.title,
    description: body.description,
    categories: body.categories,
    changeVariation: body.changeVariation,
    includedImages: body.includedImages,
    primaryImage: isText(body.primaryImage, 200) ? body.primaryImage : null,
    sprayedEdges: isTextList(body.sprayedEdges, 100) ? body.sprayedEdges : [],
    imageNameExtras,
    crops
  })
  return { savedAt: saved.savedAt }
})
