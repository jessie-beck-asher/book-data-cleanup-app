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
  const squareImages = ((data.image_ids ?? []) as string[])
    .map(imageId => ({ id: imageId, url: related.get(imageId)?.image_data?.url as string | undefined }))
    .filter((image): image is { id: string, url: string } => !!image.url)
  const images = squareImages.map(image => image.url)
  const original = await readOriginalInfo(isbn)

  // Every image that could end up on the item. Existing Square images stay unless the owner turns them off;
  // the ISBNdb cover is only included by default when the item has no image yet.
  const imageCandidates = [
    ...squareImages.map(image => ({
      key: `square:${image.id}`,
      source: 'square' as const,
      label: 'Current in Square',
      url: image.url,
      bytes: null as number | null,
      defaultOn: true
    })),
    ...(original
      ? [{
          key: `isbndb:${isbn}`,
          source: 'isbndb' as const,
          label: 'ISBNdb cover',
          url: `/api/images/original/${isbn}`,
          bytes: original.bytes,
          defaultOn: squareImages.length === 0
        }]
      : []),
    ...(await listUploaded(isbn)).map(upload => ({
      key: `upload:${upload.name}`,
      source: 'upload' as const,
      label: 'Your upload',
      url: `/api/images/uploaded/${isbn}/${upload.name}`,
      bytes: upload.bytes as number | null,
      defaultOn: false
    }))
  ]

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
      variation: mergeVariation(data),
      categories: mergeCategories({
        squareCategories: categories as string[],
        isbndbSubjects: isbndb.status === 'found' ? isbndb.subjects : []
      })
    },
    imageCandidates,
    saved: (await readEdits())[item.id] ?? null,
    // The item exactly as Square returned it, plus the category and image objects it points to.
    squareRaw: {
      item,
      relatedObjects: [...(data.categories ?? []).map((category: { id: string }) => category.id), ...(data.image_ids ?? [])]
        .map((relatedId: string) => related.get(relatedId))
        .filter(Boolean)
    },
    categoryChoices: [BOOKS_CATEGORY, ...GENRE_CATEGORIES],
    isbndbRaw: record ?? null
  }
})
