// Server-only Square client. Phase 1 is read-only: nothing here writes to Square.
const SQUARE_VERSION = '2025-01-23'

const BASE_URLS = {
  sandbox: 'https://connect.squareupsandbox.com',
  production: 'https://connect.squareup.com'
} as const

// POST is used only because Square's search endpoints take a request body; they do not modify anything.
export async function squareReadSearch(path: '/v2/catalog/search', body: Record<string, unknown>) {
  const environment = getSquareEnvironment()
  if (environment === 'unset' || environment === 'invalid') {
    throw createError({ statusCode: 400, statusMessage: `SQUARE_ENVIRONMENT is ${environment}` })
  }
  const token = process.env.SQUARE_ACCESS_TOKEN?.trim()
  if (!token) {
    throw createError({ statusCode: 400, statusMessage: 'SQUARE_ACCESS_TOKEN is not set' })
  }

  const response = await fetch(`${BASE_URLS[environment]}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  const json = await response.json().catch(() => null)
  if (!response.ok) {
    // Only Square's error codes are surfaced, never request headers or the token.
    const errors = (json?.errors ?? []).map((e: { category?: string, code?: string }) => ({ category: e.category, code: e.code }))
    throw createError({ statusCode: response.status, statusMessage: 'Square request failed', data: { errors } })
  }
  return { environment, json }
}

// ---- Single-item update helpers (Phase 4) ----
// Reads of one object use GET. Writes are refused unless the environment is the sandbox.

function squareConfig() {
  const environment = getSquareEnvironment()
  if (environment === 'unset' || environment === 'invalid') {
    throw createError({ statusCode: 400, statusMessage: `SQUARE_ENVIRONMENT is ${environment}` })
  }
  const token = process.env.SQUARE_ACCESS_TOKEN?.trim()
  if (!token) throw createError({ statusCode: 400, statusMessage: 'SQUARE_ACCESS_TOKEN is not set' })
  return { environment, token }
}

async function squareFetch(path: string, init: { method: string, json?: unknown, form?: FormData }, write: boolean) {
  const { environment, token } = squareConfig()
  if (write && environment !== 'sandbox') {
    throw createError({ statusCode: 403, statusMessage: 'Writing to Square is only enabled in the sandbox for now' })
  }
  const response = await fetch(`${BASE_URLS[environment]}${path}`, {
    method: init.method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Square-Version': SQUARE_VERSION,
      ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined)
  })
  const json = await response.json().catch(() => null)
  if (!response.ok) {
    // Square's own error codes and messages only, never request headers or the token.
    const errors = (json?.errors ?? []).map((e: { category?: string, code?: string, field?: string, detail?: string }) => ({
      category: e.category, code: e.code, field: e.field, detail: e.detail
    }))
    const summary = errors.map((e: { code?: string, field?: string, detail?: string }) => [e.code, e.field, e.detail].filter(Boolean).join(' / ')).join('; ')
    throw createError({ statusCode: response.status, statusMessage: `Square request failed: ${summary || response.status}`, data: { errors } })
  }
  return json
}

export function squareGet(path: string) {
  return squareFetch(path, { method: 'GET' }, false)
}

export function squareWriteJson(path: string, body: unknown) {
  return squareFetch(path, { method: 'POST', json: body }, true)
}

export function squareWriteForm(path: string, form: FormData) {
  return squareFetch(path, { method: 'POST', form }, true)
}
