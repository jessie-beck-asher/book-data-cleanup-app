// Turns a source picture plus the owner's crop into the square JPEG that would go to Square.
// Limits are the owner's: longest side 1200 to 2000 px, file size 150 to 500 KB, JPEG quality about 85 to 90.
import sharp from 'sharp'

export const MIN_SIDE = 1200
export const MAX_SIDE = 2000
export const MIN_BYTES = 150 * 1024
export const MAX_BYTES = 500 * 1024
const QUALITIES = [90, 88, 86, 85]
const SHRINK_STEP = 0.9

// zoom 1 shows the whole picture inside the square frame; cx and cy are where its middle sits in the frame (0.5 is centered).
export interface Crop { zoom: number, cx: number, cy: number }

export interface OptimizedImage {
  buffer: Buffer
  width: number
  height: number
  bytes: number
  quality: number
  warnings: string[]
}

export async function optimizeImage(source: Buffer, crop: Crop): Promise<OptimizedImage> {
  // Rotate by the photo's own orientation tag, then put any transparency on white (JPEG has none).
  const upright = await sharp(source).rotate().flatten({ background: '#ffffff' }).toBuffer({ resolveWithObject: true })
  const sourceWidth = upright.info.width
  const sourceHeight = upright.info.height
  const longest = Math.max(sourceWidth, sourceHeight)
  const warnings: string[] = []

  // The frame covers this many source pixels per side, so this is the size where nothing is enlarged.
  const nativeSide = Math.round(longest / crop.zoom)
  let side = Math.min(MAX_SIDE, Math.max(MIN_SIDE, nativeSide))
  if (nativeSide < MIN_SIDE) warnings.push(`Low resolution: the cropped area is only ${nativeSide} px across and was enlarged to ${MIN_SIDE} px.`)

  async function render(canvas: number, quality: number) {
    const fit = canvas / longest * crop.zoom
    const width = Math.max(1, Math.round(sourceWidth * fit))
    const height = Math.max(1, Math.round(sourceHeight * fit))
    const left = Math.round(crop.cx * canvas - width / 2)
    const top = Math.round(crop.cy * canvas - height / 2)

    // Only the part of the picture that lands inside the square is kept.
    const x0 = Math.max(0, -left)
    const y0 = Math.max(0, -top)
    const x1 = Math.min(width, canvas - left)
    const y1 = Math.min(height, canvas - top)
    const base = sharp({ create: { width: canvas, height: canvas, channels: 3, background: '#ffffff' } })
    let image = base
    if (x1 > x0 && y1 > y0) {
      const visible = await sharp(upright.data)
        .resize(width, height, { fit: 'fill' })
        .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
        .toBuffer()
      image = base.composite([{ input: visible, left: left + x0, top: top + y0 }])
    }
    return image.jpeg({ quality, mozjpeg: true }).toBuffer()
  }

  let quality = QUALITIES[0]!
  let buffer = await render(side, quality)
  // Over 500 KB: lower the quality first (down to 85), then shrink the square toward 1200 px.
  for (const next of QUALITIES.slice(1)) {
    if (buffer.length <= MAX_BYTES) break
    quality = next
    buffer = await render(side, quality)
  }
  while (buffer.length > MAX_BYTES && side > MIN_SIDE) {
    side = Math.max(MIN_SIDE, Math.round(side * SHRINK_STEP))
    buffer = await render(side, quality)
  }

  if (buffer.length > MAX_BYTES) warnings.push(`Still ${Math.round(buffer.length / 1024)} KB at the smallest allowed size (${side} px, quality ${quality}). It is over the 500 KB limit.`)
  if (buffer.length < MIN_BYTES) warnings.push(`Only ${Math.round(buffer.length / 1024)} KB, under the 150 KB target. The source may be low quality.`)
  return { buffer, width: side, height: side, bytes: buffer.length, quality, warnings }
}
