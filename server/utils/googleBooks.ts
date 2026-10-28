// Google Books lookups, saved to data/google-books-data.json the same way ISBNdb's are. Used only as a check on the genre suggestions.
// Google's search by ISBN returns nothing right now, so each book is searched by title and author, and a result is kept ONLY when its
// own ISBN list contains this book's ISBN. The key is optional and is sent in a header, never in the URL.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const GOOGLE_BOOKS_FILE = join(DATA_DIR, 'google-books-data.json')
const VOLUMES_URL = 'https://www.googleapis.com/books/v1/volumes'
// The owner only needs the books from this ISBN down the dashboard list (item 252 of 1,051).
export const GOOGLE_START_ISBN = '9781638932444'
// Google's default quota for the Books API is 1,000 requests a day. A book can take two requests.
export const GOOGLE_DAILY_LIMIT = 1000
// Google also limits requests per minute per user (100 by default), so stay under it.
const MIN_GAP_MS = 700
// Until one real match arrives, answers are held back; this many misses in a row at the start means something is wrong, so stop.
const SUSPICIOUS_EMPTY_RUN = 30

export interface GoogleVolume {
  id: string | null
  title: string | null
  subtitle: string | null
  authors: string[]
  publisher: string | null
  publishedDate: string | null
  categories: string[]
  mainCategory: string | null
  language: string | null
  printType: string | null
  industryIdentifiers: { type: string, identifier: string }[]
}
export interface GoogleRecord {
  status: 'found' | 'no_match'
  fetchedAt: string
  // The searches that were tried, so a "no match" can be understood later.
  queries: string[]
  // Only present when the volume's own ISBN list contains this book's ISBN.
  book?: GoogleVolume
}
export type GoogleStore = Record<string, GoogleRecord>

export async function readGoogleStore(): Promise<GoogleStore> {
  try {
    return JSON.parse(await readFile(GOOGLE_BOOKS_FILE, 'utf8'))
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

// Books in the same order as the dashboard (alphabetical by title), so "from item 252 down" means the same thing here.
async function booksInDashboardOrder(): Promise<{ isbn: string, title: string }[]> {
  const snapshot = await readSnapshot()
  const books = (snapshot?.items ?? [])
    .filter(item => getItemIsbns(item).size === 1)
    .map(item => ({ title: (item.item_data?.name as string | undefined)?.trim() || '(untitled)', isbn: [...getItemIsbns(item)][0] as string }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }))
  const seen = new Set<string>()
  return books.filter(book => !seen.has(book.isbn) && seen.add(book.isbn))
}

export async function googleIsbnsToFetch(startAt = GOOGLE_START_ISBN): Promise<{ inRange: string[], pending: string[], titles: Map<string, string> }> {
  const all = await booksInDashboardOrder()
  const start = all.findIndex(book => book.isbn === startAt)
  const range = start === -1 ? [] : all.slice(start)
  const store = await readGoogleStore()
  const inRange = range.map(book => book.isbn)
  return { inRange, pending: inRange.filter(isbn => !store[isbn]), titles: new Map(range.map(book => [book.isbn, book.title])) }
}

// What the app's title merge would call this book, reduced to a short title and the first author, for searching.
async function searchTerms(isbn: string, squareTitle: string): Promise<{ title: string, author: string }> {
  const record = (await readIsbndbStore())[isbn]
  const book = record?.status === 'found' ? record.book : null
  const merged = mergeTitle({
    squareTitle,
    squareDescription: '',
    isbndb: book ? { title: book.title, synopsis: null, authors: book.authors, binding: book.binding } : null
  })
  // Drop any subtitle or bracketed series text; those make exact searches miss.
  const title = merged.base.replace(/[:(\[].*$/, '').replace(/\s+/g, ' ').trim()
  const author = (merged.authors ?? '').split(/,|\s+and\s+/)[0]!.trim()
  return { title, author }
}

function slimVolume(item: any): GoogleVolume {
  const info = item?.volumeInfo ?? {}
  return {
    id: typeof item?.id === 'string' ? item.id : null,
    title: info.title ?? null,
    subtitle: info.subtitle ?? null,
    authors: Array.isArray(info.authors) ? info.authors : [],
    publisher: info.publisher ?? null,
    publishedDate: info.publishedDate ?? null,
    categories: Array.isArray(info.categories) ? info.categories : [],
    mainCategory: info.mainCategory ?? null,
    language: info.language ?? null,
    printType: info.printType ?? null,
    industryIdentifiers: Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : []
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// One search request. Waits and tries again on "too many per minute" or a brief outage; the per-day limit stops the run.
async function search(query: string): Promise<any[]> {
  const key = process.env.GOOGLE_BOOKS_API_KEY?.trim()
  for (let attempt = 0; ; attempt++) {
    googleJob.requests++
    const response = await fetch(`${VOLUMES_URL}?q=${encodeURIComponent(query)}&maxResults=20`, {
      headers: key ? { 'x-goog-api-key': key } : {},
      signal: AbortSignal.timeout(30000)
    })
    const json = await response.json().catch(() => null)
    if (response.ok) return Array.isArray(json?.items) ? json.items : []
    // Only the status and Google's own message are surfaced, never request headers or the key.
    const message = typeof json?.error?.message === 'string' ? json.error.message.slice(0, 200) : undefined
    const perMinute = response.status === 429 && /per minute/i.test(message ?? '')
    if (attempt >= 3 || !(perMinute || response.status === 503)) {
      throw createError({ statusCode: response.status, statusMessage: 'Google Books request failed', data: { message } })
    }
    await sleep(perMinute ? 65000 : 5000)
  }
}

const hasIsbn = (item: any, isbn: string) =>
  (item?.volumeInfo?.industryIdentifiers ?? []).some((id: any) => toIsbn13(String(id?.identifier ?? '')) === isbn)

async function lookup(isbn: string, squareTitle: string): Promise<GoogleRecord> {
  const { title, author } = await searchTerms(isbn, squareTitle)
  const fetchedAt = new Date().toISOString()
  const queries: string[] = []
  if (title) {
    // The exact-field search first; if its results don't include this ISBN, a plain search of the same words.
    for (const query of [`intitle:${title}${author ? ` inauthor:${author}` : ''}`, `${title}${author ? ` ${author}` : ''}`]) {
      queries.push(query)
      const exact = (await search(query)).find(item => hasIsbn(item, isbn))
      if (exact) return { status: 'found', fetchedAt, queries, book: slimVolume(exact) }
      if (googleJob.requests >= GOOGLE_DAILY_LIMIT) break
      await sleep(MIN_GAP_MS)
    }
  }
  return { status: 'no_match', fetchedAt, queries }
}

export interface GoogleJobState {
  running: boolean
  planned: number
  fetched: number
  noMatch: number
  withCategories: number
  requests: number
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}
export const googleJob: GoogleJobState = { running: false, planned: 0, fetched: 0, noMatch: 0, withCategories: 0, requests: 0, startedAt: null, finishedAt: null, error: null }

// Runs in the background of the local server. Resumable: each answer is saved as it arrives and saved ISBNs are never asked again.
export async function startGoogleJob() {
  const { pending, titles } = await googleIsbnsToFetch()
  Object.assign(googleJob, { running: true, planned: pending.length, fetched: 0, noMatch: 0, withCategories: 0, requests: 0, startedAt: new Date().toISOString(), finishedAt: null, error: null })
  void run(pending, titles)
}

async function run(pending: string[], titles: Map<string, string>) {
  try {
    const store = await readGoogleStore()
    // Until one real match arrives, results wait here instead of being saved, in case the searches are failing in some way.
    const held: [string, GoogleRecord][] = []
    let trusted = false
    for (const isbn of pending) {
      if (googleJob.requests >= GOOGLE_DAILY_LIMIT) {
        googleJob.error = `Reached the ${GOOGLE_DAILY_LIMIT}-request daily limit. Run it again tomorrow to continue`
        break
      }
      const started = Date.now()
      const record = await lookup(isbn, titles.get(isbn) ?? '')
      googleJob.fetched++
      if (record.status === 'no_match') googleJob.noMatch++
      else if (record.book?.categories.length) googleJob.withCategories++

      if (!trusted) {
        held.push([isbn, record])
        if (record.status === 'found') {
          trusted = true
          for (const [heldIsbn, heldRecord] of held) store[heldIsbn] = heldRecord
          held.length = 0
          await writeJsonAtomic(GOOGLE_BOOKS_FILE, store)
        } else if (held.length >= SUSPICIOUS_EMPTY_RUN) {
          throw createError({ statusCode: 502, statusMessage: `The first ${SUSPICIOUS_EMPTY_RUN} searches found nothing, so something may be wrong. Nothing from this run was saved` })
        }
      } else {
        store[isbn] = record
        await writeJsonAtomic(GOOGLE_BOOKS_FILE, store)
      }
      const wait = MIN_GAP_MS - (Date.now() - started)
      if (wait > 0) await sleep(wait)
    }
  } catch (error: any) {
    const detail = error?.data?.message ? `: ${error.data.message}` : ''
    googleJob.error = `${error?.statusCode ? `${error.statusCode} ` : ''}${error?.statusMessage ?? 'The fetch stopped'}${detail}`.slice(0, 300)
  } finally {
    googleJob.running = false
    googleJob.finishedAt = new Date().toISOString()
  }
}
