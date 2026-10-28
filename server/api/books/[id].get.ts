import sharp from 'sharp'

// A book updated before saved image choices were re-pointed after an update gets that fixed the first time it is opened.
async function savedEditFor(itemId: string) {
  let edit = (await readEdits())[itemId]
  if (edit?.wasUpdated && !edit.imagesSynced) {
    await syncSavedImages(itemId, { onlyIfStale: true })
    edit = (await readEdits())[itemId]
  }
  return edit ?? null
}

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
    .map(imageId => ({ id: imageId, url: related.get(imageId)?.image_data?.url as string | undefined, name: related.get(imageId)?.image_data?.name as string | undefined }))
    .filter((image): image is { id: string, url: string, name: string | undefined } => !!image.url)
  const images = squareImages.map(image => image.url)
  const original = await readOriginalInfo(isbn)

  // Pixel sizes of the images already in Square (read from the local copies, saved the first time they are needed).
  const squareSizes = new Map<string, number>()
  for (const image of squareImages) {
    try {
      const meta = await sharp(await loadSquareImage(image.id)).metadata()
      squareSizes.set(image.id, Math.max(meta.width ?? 0, meta.height ?? 0))
    } catch {
      // Size unknown: this image is never replaced automatically.
    }
  }
  // When the ISBNdb cover is clearly larger (15% or more on its longer side) than the biggest Square image, it is selected
  // and that Square image is turned off, which means it will be deleted from Square when the update is sent.
  // A book already updated by this app is left as it is: the image in Square is the one this app made.
  const bigSquare = squareImages.filter(image => squareSizes.get(image.id)).sort((a, b) => squareSizes.get(b.id)! - squareSizes.get(a.id)!)[0]
  const wasUpdated = (await readEdits())[item.id]?.wasUpdated === true
  const replaceWithIsbndb = !!original && !wasUpdated && !!bigSquare
    && Math.max(original.width, original.height) >= squareSizes.get(bigSquare.id)! * 1.15

  // Every image that could end up on the item. Existing Square images stay unless the owner turns them off;
  // the ISBNdb cover is only included by default when the item has no image yet.
  const imageCandidates = [
    ...squareImages.map(image => ({
      key: `square:${image.id}`,
      source: 'square' as const,
      label: 'Current in Square',
      url: image.url,
      squareName: image.name ?? '',
      bytes: null as number | null,
      defaultOn: !(replaceWithIsbndb && image.id === bigSquare?.id)
    })),
    ...(original
      ? [{
          key: `isbndb:${isbn}`,
          source: 'isbndb' as const,
          label: 'ISBNdb cover',
          url: `/api/images/original/${isbn}`,
          squareName: '',
          bytes: original.bytes,
          defaultOn: squareImages.length === 0 || replaceWithIsbndb
        }]
      : []),
    ...(await listUploaded(isbn)).map(upload => ({
      key: `upload:${upload.name}`,
      source: 'upload' as const,
      label: 'Your upload',
      url: `/api/images/uploaded/${isbn}/${upload.name}`,
      squareName: '',
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

  const listed = (await readCategoryWeight())[isbn] ?? null
  // Google Books data exists only for the books fetched so far, and only when its ISBN matched exactly.
  const google = (await readGoogleStore())[isbn] ?? null

  const mergedTitle = mergeTitle({
    squareTitle: data.name ?? '',
    squareDescription: data.description_plaintext ?? data.description ?? '',
    isbndb: book ? { title: book.title, synopsis: book.synopsis, authors: book.authors, binding: book.binding } : null
  })

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
      title: mergedTitle,
      description: mergeDescription({
        series: mergedTitle.series,
        bookOf: mergedTitle.bookOf,
        squareDescription: data.description_plaintext ?? data.description ?? '',
        isbndbDescription: isbndb.status === 'found' ? isbndb.description : null
      }),
      variation: mergeVariation(data),
      categories: mergeCategories({
        squareCategories: categories as string[],
        isbndbSubjects: isbndb.status === 'found' ? isbndb.subjects : [],
        googleCategories: google?.status === 'found' ? google.book?.categories ?? [] : null,
        titleText: mergedTitle.base,
        descriptionText: (isbndb.status === 'found' ? isbndb.description : null) ?? data.description_plaintext ?? data.description ?? ''
      })
    },
    // Weight (pounds) from the owner's own list; used when ISBNdb has none.
    listedWeight: listed?.weight ?? null,
    imageCandidates,
    saved: await savedEditFor(item.id),
    // The item exactly as Square returned it, plus the category and image objects it points to.
    // Square's copy of this item from just before each change this app made, newest first.
    backups: await listBackups(item.id),
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
