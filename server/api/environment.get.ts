// Exposes only the environment name, never any keys or tokens.
export default defineEventHandler(() => ({
  squareEnvironment: getSquareEnvironment()
}))
