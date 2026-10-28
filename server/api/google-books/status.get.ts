// Counts for the Google Books fetch, plus the progress of a running fetch. Reads local files only; no requests are made.
export default defineEventHandler(async () => {
  const { inRange, pending } = await googleIsbnsToFetch()
  const store = await readGoogleStore()
  const saved = inRange.filter(isbn => store[isbn])
  const found = saved.filter(isbn => store[isbn]!.status === 'found')
  return {
    startIsbn: GOOGLE_START_ISBN,
    inRange: inRange.length,
    alreadySaved: saved.length,
    found: found.length,
    noMatch: saved.length - found.length,
    withCategories: found.filter(isbn => store[isbn]!.book?.categories.length).length,
    pending: pending.length,
    wouldRequest: Math.min(pending.length, GOOGLE_DAILY_LIMIT),
    dailyLimit: GOOGLE_DAILY_LIMIT,
    keySet: !!process.env.GOOGLE_BOOKS_API_KEY?.trim(),
    job: { ...googleJob }
  }
})
