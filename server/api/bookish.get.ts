// Bookish Items list: items in the local Square snapshot with no valid ISBN, alphabetical by title. Reads only the local file.
export default defineEventHandler(async () => {
  const snapshot = await readSnapshot()
  if (!snapshot) return { hasSnapshot: false as const, items: [] }

  const updated = await readBookishUpdated()
  const weights = await readBookishWeights()
  const flags = await readFlags()
  const items = snapshot.items
    .filter(item => getItemIsbns(item).size === 0)
    .map(item => ({
      id: item.id as string,
      title: (item.item_data?.name as string | undefined)?.trim() || '(untitled)',
      archived: item.item_data?.is_archived === true,
      wasUpdated: !!updated[item.id],
      flagged: !!flags[item.id],
      weight: weights[item.id]?.pounds ?? null,
      skus: [...new Set<string>(
        (item.item_data?.variations ?? [])
          .map((variation: any) => (variation?.item_variation_data?.sku as string | undefined)?.trim())
          .filter(Boolean)
      )]
    }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }))

  return { hasSnapshot: true as const, items }
})
