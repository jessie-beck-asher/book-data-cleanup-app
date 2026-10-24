import { join } from 'node:path'

// Step A test: looks up the first 5 book ISBNs from the snapshot in ONE ISBNdb batch request (costs 5 quota).
// ISBNs already in data/isbndb-data.json are never requested again.
const TEST_COUNT = 5

export default defineEventHandler(async () => {
  const snapshot = await readSnapshot()
  if (!snapshot) throw createError({ statusCode: 400, statusMessage: 'No Square snapshot yet. Pull the catalog first.' })

  const isbns: string[] = []
  for (const item of snapshot.items) {
    const found = getItemIsbns(item)
    if (found.size === 1) isbns.push([...found][0]!)
    if (isbns.length === TEST_COUNT) break
  }

  const store = await readIsbndbStore()
  const toFetch = isbns.filter(isbn => !store[isbn])
  let requested: number | null = null
  let total: number | null = null

  if (toFetch.length > 0) {
    const json = await isbndbBatchLookup(toFetch)
    if (!Array.isArray(json?.data)) {
      // Unknown response shape: keep it for inspection, cache nothing.
      await writeJsonAtomic(join(DATA_DIR, 'isbndb-unparsed.json'), json)
      throw createError({
        statusCode: 502,
        statusMessage: 'Unexpected ISBNdb response shape',
        data: { topLevelKeys: Object.keys(json ?? {}), savedTo: 'data/isbndb-unparsed.json' }
      })
    }
    requested = json.requested ?? null
    total = json.total ?? null

    const fetchedAt = new Date().toISOString()
    const returned = new Set<string>()
    for (const book of json.data) {
      const keys = [toIsbn13(book?.isbn13), toIsbn13(book?.isbn)].filter((k): k is string => !!k)
      for (const key of keys) {
        if (toFetch.includes(key)) {
          store[key] = { status: 'found', fetchedAt, book }
          returned.add(key)
        }
      }
    }
    // ISBNdb omits books it can't find, so "no match" is whatever we asked for and didn't get back.
    for (const isbn of toFetch) {
      if (!returned.has(isbn)) store[isbn] = { status: 'no_match', fetchedAt }
    }
    await writeIsbndbStore(store)
  }

  // Field names and weight/image hints only, no titles or ISBNs.
  const books = isbns.map((isbn, index) => {
    const record = store[isbn]!
    const book = record.book ?? {}
    const keys = Object.keys(book)
    const imageHost = typeof book.image === 'string' ? new URL(book.image).hostname : null
    return {
      number: index + 1,
      status: record.status,
      fromCache: !toFetch.includes(isbn),
      fields: keys,
      weightLike: Object.fromEntries(keys.filter(k => /weight|dimension/i.test(k)).map(k => [k, book[k]])),
      imageHost
    }
  })

  return {
    asked: toFetch.length,
    requested,
    total,
    books,
    raw: Object.fromEntries(isbns.map(isbn => [isbn, store[isbn]])),
    savedTo: 'data/isbndb-data.json'
  }
})
