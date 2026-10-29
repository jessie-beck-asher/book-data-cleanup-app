import { weightInPounds } from '../../shared/weight.ts'
// Dashboard list: book items from the local Square snapshot, alphabetical by title. Reads only the local file.
export default defineEventHandler(async () => {
  const snapshot = await readSnapshot()
  if (!snapshot) return { hasSnapshot: false as const, books: [] }

  const edits = await readEdits()
  const isbndbStore = await readIsbndbStore()
  const listed = await readCategoryWeight()
  const flags = await readFlags()
  const books = snapshot.items
    .filter(item => getItemIsbns(item).size === 1)
    .map(item => ({
      id: item.id as string,
      title: (item.item_data?.name as string | undefined)?.trim() || '(untitled)',
      isbn: [...getItemIsbns(item)][0] as string,
      archived: item.item_data?.is_archived === true,
      // Becomes true only once Square confirms an update; nothing writes to Square yet.
      wasUpdated: edits[item.id]?.wasUpdated === true,
      flagged: !!flags[item.id],
      // Shipping weight in pounds from the saved ISBNdb record, else from the owner's own list, else null.
      weight: weightInPounds(isbndbStore[[...getItemIsbns(item)][0]!]?.book?.dimensions_structured)?.pounds
        ?? listed[[...getItemIsbns(item)][0]!]?.weight ?? null
    }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }))

  return { hasSnapshot: true as const, books }
})
