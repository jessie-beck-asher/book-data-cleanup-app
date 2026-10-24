// The full ISBNdb fetch, run in the background of the local server so the browser can poll its progress.
// Resumable: every batch is saved as soon as it arrives, and ISBNs already saved (including "no match") are never requested again.
// ISBNdb image links expire in about 2 hours, so each batch's covers are downloaded right after that batch arrives.
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import sharp from 'sharp'

export const BATCH_SIZE = 100
// Basic plan: 5,000 lookups a day, charged per ISBN.
export const DAILY_LIMIT = 5000
const MIN_GAP_MS = 1200

export interface IsbndbJobState {
  running: boolean
  planned: number
  fetched: number
  batchesDone: number
  batchesTotal: number
  coversSaved: number
  coversFailed: number
  noMatch: number
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

export const isbndbJob: IsbndbJobState = {
  running: false, planned: 0, fetched: 0, batchesDone: 0, batchesTotal: 0,
  coversSaved: 0, coversFailed: 0, noMatch: 0, startedAt: null, finishedAt: null, error: null
}

export async function bookIsbnsInSnapshot(): Promise<string[]> {
  const snapshot = await readSnapshot()
  const isbns = new Set<string>()
  for (const item of snapshot?.items ?? []) {
    const found = getItemIsbns(item)
    if (found.size === 1) isbns.add([...found][0]!)
  }
  return [...isbns]
}

const fileExists = (file: string) => stat(file).then(() => true, () => false)

// Saves the original cover. Returns 'saved', 'none' (ISBNdb has no image link) or 'failed'.
async function downloadCover(isbn: string, book: any): Promise<'saved' | 'none' | 'failed'> {
  const file = originalImagePath(isbn)
  if (await fileExists(file)) return 'saved'
  const urls = [book?.image_original, book?.image].filter((url): url is string => typeof url === 'string' && url.startsWith('https://'))
  if (!urls.length) return 'none'
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!response.ok) continue
      const buffer = Buffer.from(await response.arrayBuffer())
      await sharp(buffer).metadata() // throws if it is not a real image
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, buffer)
      return 'saved'
    } catch {
      // Try the next link.
    }
  }
  return 'failed'
}

async function downloadCovers(isbns: string[], store: IsbndbStore) {
  const queue = isbns.filter(isbn => store[isbn]?.status === 'found')
  const worker = async () => {
    for (let isbn = queue.shift(); isbn; isbn = queue.shift()) {
      const result = await downloadCover(isbn, store[isbn]!.book)
      store[isbn]!.cover = result
      if (result === 'saved') isbndbJob.coversSaved++
      else if (result === 'failed') isbndbJob.coversFailed++
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker))
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function pendingIsbns() {
  const store = await readIsbndbStore()
  return (await bookIsbnsInSnapshot()).filter(isbn => !store[isbn])
}

// Starts the run in the background. The caller has already confirmed the quota cost.
export async function startIsbndbJob() {
  const pending = (await pendingIsbns()).slice(0, DAILY_LIMIT)
  Object.assign(isbndbJob, {
    running: true, planned: pending.length, fetched: 0, batchesDone: 0, batchesTotal: Math.ceil(pending.length / BATCH_SIZE),
    coversSaved: 0, coversFailed: 0, noMatch: 0, startedAt: new Date().toISOString(), finishedAt: null, error: null
  })
  void run(pending)
}

async function run(pending: string[]) {
  try {
    let lastRequest = 0
    for (let start = 0; start < pending.length; start += BATCH_SIZE) {
      const batch = pending.slice(start, start + BATCH_SIZE)
      const wait = lastRequest + MIN_GAP_MS - Date.now()
      if (wait > 0) await sleep(wait)
      lastRequest = Date.now()

      const json = await isbndbBatchLookup(batch)
      if (!Array.isArray(json?.data)) throw createError({ statusCode: 502, statusMessage: 'Unexpected ISBNdb response shape' })

      const store = await readIsbndbStore()
      const fetchedAt = new Date().toISOString()
      const returned = new Set<string>()
      for (const book of json.data) {
        for (const key of [toIsbn13(book?.isbn13), toIsbn13(book?.isbn)]) {
          if (key && batch.includes(key)) {
            store[key] = { status: 'found', fetchedAt, book }
            returned.add(key)
          }
        }
      }
      // ISBNdb omits books it can't find, so "no match" is whatever was asked for and not returned.
      for (const isbn of batch) {
        if (!returned.has(isbn)) {
          store[isbn] = { status: 'no_match', fetchedAt }
          isbndbJob.noMatch++
        }
      }
      await writeIsbndbStore(store) // saved before the covers, so nothing is lost if a download hangs

      await downloadCovers(batch, store)
      await writeIsbndbStore(store)

      isbndbJob.fetched += batch.length
      isbndbJob.batchesDone++
    }
  } catch (error: any) {
    const message = error?.data?.message ?? error?.statusMessage ?? 'The fetch stopped'
    isbndbJob.error = `${error?.statusMessage ?? 'Error'}${error?.data?.message ? `: ${error.data.message}` : ''}`.slice(0, 300) || message
  } finally {
    isbndbJob.running = false
    isbndbJob.finishedAt = new Date().toISOString()
  }
}
