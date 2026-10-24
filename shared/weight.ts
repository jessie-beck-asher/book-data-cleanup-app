// Pulls just the weight out of ISBNdb's dimensions_structured and gives it in pounds.
const POUNDS_PER: Record<string, number> = {
  pound: 1, lb: 1,
  ounce: 1 / 16, oz: 1 / 16,
  gram: 0.00220462262, g: 0.00220462262,
  kilogram: 2.20462262, kg: 2.20462262
}

export function weightInPounds(dimensions: any): { pounds: number, from: string } | null {
  const weight = dimensions?.weight
  const value = Number(weight?.value)
  if (!Number.isFinite(value) || value <= 0) return null
  const unit = String(weight?.unit ?? '').trim().toLowerCase().replace(/s$/, '').replace(/\.$/, '')
  const factor = POUNDS_PER[unit]
  if (!factor) return null
  const pounds = Math.round(value * factor * 100) / 100
  return { pounds, from: unit === 'pound' || unit === 'lb' ? '' : `${value} ${weight.unit}` }
}
