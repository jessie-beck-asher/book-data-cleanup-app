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
