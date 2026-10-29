// Bookish item detail data: the item's current Square values as pulled, plus the raw item. Reads only the local snapshot.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const snapshot = await readSnapshot()
  if (!snapshot) throw createError({ statusCode: 404, statusMessage: 'No Square snapshot yet' })

  const item = snapshot.items.find(candidate => candidate.id === id)
  if (!item || getItemIsbns(item).size !== 0) throw createError({ statusCode: 404, statusMessage: 'Item not found' })

  const related = new Map(snapshot.relatedObjects.map(object => [object.id, object]))
  const data = item.item_data ?? {}
  const money = (value: { amount?: number, currency?: string } | undefined) =>
    value?.amount === undefined ? null : `${(value.amount / 100).toFixed(2)} ${value.currency ?? ''}`.trim()
  const plannedNames = (await readCategoryPlan()).map(node => node.name.trim().toLowerCase())
  const categoryName = (categoryId: string) => related.get(categoryId)?.category_data?.name as string | undefined

  // Item options (like Size or Color) are not in the pulled snapshot, so their names are read from Square (a read only). Falls back to the IDs.
  const optionIds = [...new Set<string>((data.variations ?? []).flatMap((variation: any) =>
    (variation.item_variation_data?.item_option_values ?? []).map((value: any) => value.item_option_id)))]
  const options = new Map<string, any>()
  await Promise.all(optionIds.map(async (optionId) => {
    try {
      const live = await squareGet(`/v2/catalog/object/${encodeURIComponent(optionId)}`)
      if (live?.object) options.set(optionId, live.object.item_option_data)
    } catch {
      // The ID is shown instead.
    }
  }))
  const optionValueName = (optionId: string, valueId: string) =>
    options.get(optionId)?.values?.find((value: any) => value.id === valueId)?.item_option_value_data?.name as string | undefined

  // On-hand counts are not in the catalog snapshot, so they are read from Square's inventory (a read only), summed across locations.
  // quantities stays null if Square refuses the read (for example when the access token has no inventory permission).
  let inventoryError: string | null = null
  const quantities = new Map<string, number>()
  await Promise.all((data.variations ?? []).map(async (variation: any) => {
    try {
      const live = await squareGet(`/v2/inventory/${encodeURIComponent(variation.id)}`)
      const counts = (live?.counts ?? []).filter((count: any) => count.state === 'IN_STOCK')
      quantities.set(variation.id, counts.reduce((sum: number, count: any) => sum + Number(count.quantity ?? 0), 0))
    } catch (error: any) {
      inventoryError = error?.statusMessage ?? 'Could not read inventory'
    }
  }))

  const imageUrl = (imageId: string) => related.get(imageId)?.image_data?.url as string | undefined

  const variations = (data.variations ?? []).map((variation: any) => {
    const v = variation.item_variation_data ?? {}
    return {
      id: variation.id as string,
      name: (v.name as string | undefined) ?? '',
      sku: (v.sku as string | undefined) ?? '',
      gtin: (v.upc as string | undefined) ?? '',
      price: money(v.price_money),
      pricingType: (v.pricing_type as string | undefined) ?? '',
      trackInventory: v.track_inventory === true,
      quantity: quantities.get(variation.id) ?? null,
      // Images tied to this variation. Square normally keeps these inside the item's own image list.
      images: ((v.image_ids ?? []) as string[]).map(imageId => ({ id: imageId, url: imageUrl(imageId) ?? null, onItem: (data.image_ids ?? []).includes(imageId) })),
      options: (v.item_option_values ?? []).map((value: any) => {
        return {
          option: (options.get(value.item_option_id)?.name as string | undefined) ?? value.item_option_id,
          value: optionValueName(value.item_option_id, value.item_option_value_id) ?? value.item_option_value_id
        }
      })
    }
  })

  return {
    id: item.id as string,
    version: item.version as number | undefined,
    archived: data.is_archived === true,
    pulledAt: snapshot.pulledAt,
    square: {
      title: (data.name as string | undefined) ?? '',
      description: (data.description_plaintext ?? data.description ?? '') as string,
      productType: (data.product_type as string | undefined) ?? '',
      categories: (data.categories ?? []).map((category: { id: string }) => categoryName(category.id) ?? category.id),
      categoryIds: (data.categories ?? []).map((category: { id: string }) => category.id as string),
      reportingCategory: data.reporting_category?.id ? (categoryName(data.reporting_category.id) ?? data.reporting_category.id) : null,
      // Every image on the item, with the variations (by SKU or name) it is tied to. An empty list means no variation uses it.
      images: ((data.image_ids ?? []) as string[])
        .map(imageId => ({
          id: imageId,
          url: imageUrl(imageId),
          variations: variations.filter((variation: any) => variation.images.some((image: any) => image.id === imageId))
            .map((variation: any) => variation.sku || variation.name || variation.id),
          variationIds: variations.filter((variation: any) => variation.images.some((image: any) => image.id === imageId))
            .map((variation: any) => variation.id as string),
          // The variation names (with their option values when the variation has no name of its own), for naming the image file.
          variationNames: variations.filter((variation: any) => variation.images.some((image: any) => image.id === imageId))
            .map((variation: any) => (variation.name || variation.options.map((option: any) => option.value).join(' ')) as string)
        }))
        .filter(image => !!image.url) as { id: string, url: string, variations: string[], variationIds: string[], variationNames: string[] }[],
      variations
    },
    // Every category in the local copy, for the Categories picker.
    // planned = a top-level category named in the owner's category plan (its sub-categories go with it); listed in plan order.
    allCategories: snapshot.relatedObjects
      .filter(object => object.type === 'CATEGORY' && object.category_data?.name)
      .map(object => ({
        id: object.id as string,
        name: object.category_data.name as string,
        parentId: object.category_data.is_top_level ? null : ((object.category_data.parent_category?.id as string | undefined) ?? null)
      }))
      .map((category, _index, all) => {
        const rootId = category.parentId ?? category.id
        const root = all.find(other => other.id === rootId)
        return { ...category, planned: !!root && plannedNames.includes(root.name.toLowerCase()) }
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    plannedOrder: plannedNames,
    altDrafts: Object.fromEntries(Object.entries(await readAltDrafts()).map(([imageId, draft]) => [imageId, draft.alt])),
    uploads: (await listBookishUploads(item.id as string)).map(upload => ({ id: upload.id, url: `/api/bookish/${item.id}/upload/${upload.name}`, bytes: upload.bytes })),
    weight: (await readBookishWeights())[item.id as string]?.pounds ?? null,
    inventoryError,
    squareRaw: {
      item,
      relatedObjects: [
        ...(data.categories ?? []).map((category: { id: string }) => category.id),
        ...(data.image_ids ?? []),
        ...(data.variations ?? []).flatMap((variation: any) => variation.item_variation_data?.image_ids ?? []),
        ...(data.variations ?? []).flatMap((variation: any) => (variation.item_variation_data?.item_option_values ?? [])
          .flatMap((value: any) => [value.item_option_id, value.item_option_value_id]))
      ].map((relatedId: string) => related.get(relatedId)).filter(Boolean)
    }
  }
})
