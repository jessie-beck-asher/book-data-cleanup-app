// Low detail mode (detail: 'low', OpenAI only) keeps the cost down: OpenAI reads each picture at 512 px for a small fixed price.
// Writes alt text with OpenAI for the pictures the page lists, and ONLY those. Each one is sent alone, as the optimized picture that would go
// to Square shrunk to 512 px, with fixed instructions. No item title, variation or description goes along. Nothing is sent to Square. The API key comes from OPENAI_API_KEY and is never returned or logged.
import sharp from 'sharp'

interface Body { images?: { id?: string, crop?: { zoom?: number, cx?: number, cy?: number } }[] }

const MAX_IMAGES = 15
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const INSTRUCTIONS = [
  'Write alt text for this product picture in 150 characters or less, in 1 to 2 short sentences.',
  'Describe what is visible: what the product is, its colors and materials, and what the picture shows.',
  'Do not use redundant phrases like "image of", "picture of" or "photo of"; start with the description itself.',
  'If there is any text visible inside the graphic, transcribe it exactly.',
  'Reply only with JSON: {"alt": "<the alt text>"}'
].join(' ')

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) throw createError({ statusCode: 400, statusMessage: 'OPENAI_API_KEY is not set. Add it to .env and restart the dev server.' })
  // Two ways to run, picked by .env:
  //  - OPENAI_BASE_URL and OPENAI_VISION_MODEL both set: that provider's OpenAI-compatible endpoint (for example Google Gemini) with the same key.
  //  - Otherwise: OpenAI itself, with OPENAI_MODEL (default gpt-4o-mini). Remove the two settings to go back to this.
  const customBase = process.env.OPENAI_BASE_URL?.trim().replace(/\/+$/, '')
  const customModel = process.env.OPENAI_VISION_MODEL?.trim()
  const custom = !!customBase && !!customModel
  if (custom && !customBase.startsWith('https://')) throw createError({ statusCode: 400, statusMessage: 'OPENAI_BASE_URL must start with https://' })
  const model = custom ? customModel : process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
  const endpoint = custom ? `${customBase}/chat/completions` : 'https://api.openai.com/v1/chat/completions'

  const body = await readBody<Body>(event).catch(() => null)
  const wanted = body?.images ?? []
  if (!Array.isArray(wanted) || !wanted.length || wanted.length > MAX_IMAGES) throw createError({ statusCode: 400, statusMessage: `Send between 1 and ${MAX_IMAGES} images` })

  const snapshot = await readSnapshot()
  const item = snapshot?.items.find(candidate => candidate.id === id)
  if (!item || getItemIsbns(item).size !== 0) throw createError({ statusCode: 404, statusMessage: 'Item not found' })
  const data = item.item_data ?? {}
  const itemImageIds: string[] = [...(data.image_ids ?? []), ...(data.variations ?? []).flatMap((variation: any) => variation.item_variation_data?.image_ids ?? [])]

  const results: { id: string, alt: string }[] = []
  const errors: { id: string, error: string }[] = []
  const seen = new Set<string>()
  for (const entry of wanted) {
    const imageId = entry?.id
    if (!imageId || !/^[A-Za-z0-9_-]{1,64}$/.test(imageId) || seen.has(imageId)) continue
    seen.add(imageId)
    const crop = entry.crop && isNumber(entry.crop.zoom) && isNumber(entry.crop.cx) && isNumber(entry.crop.cy)
      && entry.crop.zoom >= 0.5 && entry.crop.zoom <= 4 && Math.abs(entry.crop.cx) <= 5 && Math.abs(entry.crop.cy) <= 5
      ? { zoom: entry.crop.zoom, cx: entry.crop.cx, cy: entry.crop.cy }
      : { zoom: 1, cx: 0.5, cy: 0.5 }
    try {
      // Only pictures that belong to this item (its own Square images or an upload for it) can be sent.
      const fromUpload = isUploadId(imageId)
      if (!fromUpload && !itemImageIds.includes(imageId)) throw new Error('That image is not on this item')
      const source = fromUpload ? await readBookishUpload(id, imageId) : await loadSquareImage(imageId)
      const optimized = await optimizeImage(source, crop)
      const small = await sharp(optimized.buffer).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()

      // A busy service (503) or a rate limit (429) is tried again a couple of times before giving up on this picture.
      let response!: Response
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await new Promise(resolve => setTimeout(resolve, attempt * 3000))
        response = await fetch(endpoint, {
          method: 'POST',
          // A stuck request gives up after a minute instead of hanging the button.
          signal: AbortSignal.timeout(60_000),
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            // Models that think before answering (some Gemini ones) spend part of this on thinking, so it is generous for them.
            max_tokens: custom ? 600 : 200,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: INSTRUCTIONS },
              // Only the picture is sent: no item title, variation or description.
              { role: 'user', content: [
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${small.toString('base64')}`, ...(custom ? {} : { detail: 'low' }) } }
              ] }
            ]
          })
        })
        if (response.status !== 503 && response.status !== 429) break
      }
      const json: any = await response.json().catch(() => null)
      // Only OpenAI's own error text is passed on, never request headers or the key.
      if (!response.ok) throw new Error(`${json?.error?.message ?? json?.[0]?.error?.message ?? 'The AI service refused the request'} (status ${response.status} from ${new URL(endpoint).host}${new URL(endpoint).pathname}, model ${model})`)
      // The reply should be {"alt": "..."}; other providers sometimes wrap it in code fences or send plain text, so that is handled too.
      const content = String(json?.choices?.[0]?.message?.content ?? '').trim()
      let alt = ''
      try {
        alt = String(JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')).alt ?? '')
      } catch {
        alt = content.replace(/^["']|["']$/g, '')
      }
      alt = alt.trim().replace(/\s+/g, ' ')
      if (!alt) throw new Error('The AI service sent back no alt text')
      results.push({ id: imageId, alt })
    } catch (error: any) {
      errors.push({ id: imageId, error: error?.name === 'TimeoutError' ? 'The AI service took longer than a minute and was stopped' : error?.message ?? 'Failed' })
    }
  }

  if (results.length) await saveAltDrafts(Object.fromEntries(results.map(result => [result.id, result.alt])))
  return { model, results, errors }
})
