// Server-only. Secrets are read here from process.env (loaded from .env) and never sent to the browser.
export function getSquareEnvironment(): 'sandbox' | 'production' | 'unset' | 'invalid' {
  const value = process.env.SQUARE_ENVIRONMENT?.trim().toLowerCase()
  if (!value) return 'unset'
  if (value === 'sandbox' || value === 'production') return value
  return 'invalid'
}
