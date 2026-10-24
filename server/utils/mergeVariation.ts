// Proposes the single variation of a book as "Regular". Pure functions with no Nuxt imports so they can be tested on their own.

export const REGULAR_VARIATION = 'Regular'

export interface MergedVariation {
  // False when the item does not have exactly one variation, in which case nothing is proposed.
  handled: boolean
  currentName: string
  proposedName: string
  needsChange: boolean
  // Number of item options (such as Language and Format) tied to the variation; these would be removed.
  optionCount: number
  // What stays exactly as it is in Square, for display.
  preserved: string[]
  notes: string[]
}

function formatMoney(money: { amount?: number, currency?: string } | undefined) {
  if (!money || typeof money.amount !== 'number') return null
  return `${(money.amount / 100).toFixed(2)} ${money.currency ?? ''}`.trim()
}

export function mergeVariation(itemData: any): MergedVariation {
  const variations: any[] = itemData?.variations ?? []
  if (variations.length !== 1) {
    return {
      handled: false,
      currentName: '',
      proposedName: '',
      needsChange: false,
      optionCount: 0,
      preserved: [],
      notes: [`This item has ${variations.length} variations, so nothing is proposed for it.`]
    }
  }

  const data = variations[0].item_variation_data ?? {}
  const currentName: string = data.name ?? ''
  const optionCount: number = (data.item_option_values ?? []).length
  const needsChange = currentName !== REGULAR_VARIATION || optionCount > 0

  const price = formatMoney(data.price_money)
  const preserved = [
    `Same variation (ID ${variations[0].id}), so on-hand counts stay with it`,
    `SKU: ${data.sku || '(none)'}`,
    `GTIN: ${data.upc || '(none)'}`,
    `Price: ${price ?? '(none)'}, sent back unchanged`,
    `Inventory tracking: ${data.track_inventory ? 'on' : 'off'}`,
    `Unit cost: ${formatMoney(data.default_unit_cost) ?? '(none)'}`,
    `Vendor info records: ${(data.item_variation_vendor_infos ?? []).length}`,
    `Location settings (such as sold out): ${(data.location_overrides ?? []).length}`,
    `Sales channels: ${(data.channels ?? []).length}`,
    `Variation images: ${(data.image_ids ?? []).length}`
  ]

  const notes: string[] = []
  if (!needsChange) notes.push('Already "Regular" with no item options. Nothing to change.')
  else {
    notes.push(`The variation is named "${currentName}".`)
    if (optionCount) notes.push(`It is tied to ${optionCount} item options (like Language and Format). They would be removed from the variation and from the item.`)
  }
  return { handled: true, currentName, proposedName: REGULAR_VARIATION, needsChange, optionCount, preserved, notes }
}
