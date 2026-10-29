// Builds the optimized JPEG preview for one image of a bookish item. Reads the local snapshot and the Square image (saved locally the first time).
// The preview goes straight back to the page; nothing is written to Square.
import sharp from 'sharp'

interface Body { imageId?: string, crop?: { zoom?: number, cx?: number, cy?: number } }

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const { imageId, crop } = (await readBody<Body>(event)) ?? {}
  if (!imageId || !/^[A-Za-z0-9_-]{1,64}$/.test(imageId)) throw createError({ statusCode: 400, statusMessage: 'Missing image' })
  if (!crop || !isNumber(crop.zoom) || !isNumber(crop.cx) || !isNumber(crop.cy) || crop.zoom < 0.5 || crop.zoom > 4 || Math.abs(crop.cx) > 5 || Math.abs(crop.cy) > 5) {
    throw createError({ statusCode: 400, statusMessage: 'Bad crop values' })
  }

  const snapshot = await readSnapshot()
  const item = snapshot?.items.find(candidate => candidate.id === id)
  if (!item || getItemIsbns(item).size !== 0) throw createError({ statusCode: 404, statusMessage: 'Item not found' })
  const fromUpload = isUploadId(imageId)
  const belongsToItem = fromUpload || (item.item_data?.image_ids ?? []).includes(imageId)
    || (item.item_data?.variations ?? []).some((variation: any) => (variation.item_variation_data?.image_ids ?? []).includes(imageId))
  if (!belongsToItem) throw createError({ statusCode: 404, statusMessage: 'That image is not on this item' })

  const source = fromUpload ? await readBookishUpload(id!, imageId) : await loadSquareImage(imageId)
  const meta = await sharp(source).metadata()
  const result = await optimizeImage(source, { zoom: crop.zoom, cx: crop.cx, cy: crop.cy })
  return {
    dataUrl: `data:image/jpeg;base64,${result.buffer.toString('base64')}`,
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    quality: result.quality,
    warnings: result.warnings,
    sourceBytes: source.length,
    sourceFormat: meta.format ?? ''
  }
})
