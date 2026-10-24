// Returns a valid ISBN-13 (digits only) for an ISBN-10 or ISBN-13 string, or null if it isn't one.
export function toIsbn13(raw: string | null | undefined): string | null {
  const value = (raw ?? '').replace(/[\s-]/g, '').toUpperCase()

  if (/^\d{13}$/.test(value)) {
    if (!value.startsWith('978') && !value.startsWith('979')) return null
    return isbn13CheckSum(value) % 10 === 0 ? value : null
  }

  if (/^\d{9}[\dX]$/.test(value)) {
    let sum = 0
    for (let i = 0; i < 10; i++) {
      const digit = value[i] === 'X' ? 10 : Number(value[i])
      sum += digit * (10 - i)
    }
    if (sum % 11 !== 0) return null
    const body = `978${value.slice(0, 9)}`
    return `${body}${(10 - (isbn13CheckSum(`${body}0`) % 10)) % 10}`
  }

  return null
}

function isbn13CheckSum(digits: string): number {
  let sum = 0
  for (let i = 0; i < 13; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3)
  return sum
}
