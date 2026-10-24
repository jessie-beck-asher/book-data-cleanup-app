// Detail page data: the book's current Square values plus the saved ISBNdb record, if any. Reads only local files.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const snapshot = await readSnapshot()
  if (!snapshot) throw createError({ statusCode: 404, statusMessage: 'No Square snapshot yet' })

  const item = snapshot.items.find(candidate => candidate.id === id)
  const isbns = item ? getItemIsbns(item) : null
  if (!item || isbns?.size !== 1) throw createError({ statusCode: 404, statusMessage: 'Book not found' })
  const isbn = [...isbns][0]!

  const related = new Map(snapshot.relatedObjects.map(object => [object.id, object]))
  const data = item.item_data ?? {}

  const categories = (data.categories ?? [])
    .map((category: { id: string }) => related.get(category.id)?.category_data?.name as string | undefined)
    .filter(Boolean)
  const images = (data.image_ids ?? [])
    .map((imageId: string) => related.get(imageId)?.image_data?.url as string | undefined)
    .filter(Boolean)

  const record = (await readIsbndbStore())[isbn]
  const book = record?.book
  const isbndb = !record
    ? { status: 'not_fetched' as const }
    : record.status === 'no_match'
      ? { status: 'no_match' as const }
      : {
          status: 'found' as const,
          title: book.title ?? null,
          description: typeof book.synopsis === 'string' ? htmlToPlainText(book.synopsis) : null,
          subjects: book.subjects ?? [],
          authors: book.authors ?? [],
          publisher: book.publisher ?? null,
          datePublished: book.date_published ?? null,
          pages: book.pages ?? null,
          binding: book.binding ?? null,
          // Image links from ISBNdb expire; the small one is only for previewing here.
          image: book.image ?? null,
          dimensions: book.dimensions_structured ?? null
        }

  return {
    id: item.id as string,
    isbn,
    archived: data.is_archived === true,
    square: {
      title: (data.name as string | undefined) ?? '',
      description: (data.description_plaintext ?? data.description ?? '') as string,
      categories,
      images
    },
    isbndb,
    merged: {
      title: mergeTitle({
        squareTitle: data.name ?? '',
        squareDescription: data.description_plaintext ?? data.description ?? '',
        isbndb: book ? { title: book.title, synopsis: book.synopsis, authors: book.authors, binding: book.binding } : null
      }),
      description: mergeDescription({
        squareDescription: data.description_plaintext ?? data.description ?? '',
        isbndbDescription: isbndb.status === 'found' ? isbndb.description : null
      }),
      categories: mergeCategories({
        squareCategories: categories as string[],
        isbndbSubjects: isbndb.status === 'found' ? isbndb.subjects : []
      })
    },
    categoryChoices: [BOOKS_CATEGORY, ...GENRE_CATEGORIES],
    isbndbRaw: record ?? null
  }
})
