// Counts for the ISBNdb fetch, plus the progress of a running fetch. Reads local files only; no quota is used.
import { stat } from 'node:fs/promises'

export default defineEventHandler(async () => {
  const isbns = await bookIsbnsInSnapshot()
  const store = await readIsbndbStore()
  const saved = isbns.filter(isbn => store[isbn])
  const found = saved.filter(isbn => store[isbn]!.status === 'found')
  let coversSaved = 0
  for (const isbn of found) {
    if (await stat(originalImagePath(isbn)).then(() => true, () => false)) coversSaved++
  }
  const pending = isbns.length - saved.length
  return {
    totalBooks: isbns.length,
    alreadySaved: saved.length,
    found: found.length,
    noMatch: saved.length - found.length,
    pending,
    // What the next run would use, capped at the daily limit.
    wouldRequest: Math.min(pending, DAILY_LIMIT),
    dailyLimit: DAILY_LIMIT,
    batches: Math.ceil(Math.min(pending, DAILY_LIMIT) / BATCH_SIZE),
    coversSaved,
    coversMissing: found.length - coversSaved,
    job: { ...isbndbJob }
  }
})
