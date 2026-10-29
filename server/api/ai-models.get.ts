// Lists the model names the AI service (OPENAI_BASE_URL, else OpenAI) offers for the key in .env. A read only, no pictures, no cost.
// Handy when a model name gives a 404. The key is never returned.
export default defineEventHandler(async () => {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) throw createError({ statusCode: 400, statusMessage: 'OPENAI_API_KEY is not set' })
  const base = process.env.OPENAI_BASE_URL?.trim().replace(/\/+$/, '') || 'https://api.openai.com/v1'
  if (!base.startsWith('https://')) throw createError({ statusCode: 400, statusMessage: 'OPENAI_BASE_URL must start with https://' })
  const response = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } })
  const json: any = await response.json().catch(() => null)
  if (!response.ok) {
    throw createError({ statusCode: response.status, statusMessage: `${json?.error?.message ?? json?.[0]?.error?.message ?? 'The AI service refused the request'} (status ${response.status} from ${new URL(base).host}${new URL(base).pathname})` })
  }
  const ids = ((json?.data ?? json?.models ?? []) as { id?: string, name?: string }[]).map(model => model.id ?? model.name ?? '').filter(Boolean)
  return {
    host: new URL(base).host,
    chosenModel: process.env.OPENAI_VISION_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || '(default)',
    models: ids.sort()
  }
})
