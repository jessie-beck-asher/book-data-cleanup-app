// Builds the proposed Square description. Pure functions with no Nuxt imports so they can be tested on their own.
import { cleanDescription, tidyText } from './text.ts'

// Share of the Square text's 4-word runs that must also appear in the ISBNdb text to call it the same book.
const MATCH_THRESHOLD = 0.3
// Below this many words the Square text is too short to compare against.
const MIN_WORDS_TO_COMPARE = 25
const SHINGLE_SIZE = 4

export type IsbndbCheck = 'match' | 'mismatch' | 'unverified' | 'no_isbndb_text'

export interface MergedDescription {
  description: string
  source: 'isbndb' | 'square' | 'none'
  isbndbCheck: IsbndbCheck
  overlap: number | null
  removedPublisherTag: string | null
  // True when the Square description was used and appears to end mid-sentence.
  looksCutOff: boolean
  notes: string[]
}

// Square descriptions from scanning often begin with a publisher tag like "[Atria]".
export function stripPublisherTag(text: string): { text: string, tag: string | null } {
  const match = /^\s*\[([^\]]{1,60})\]\s*/.exec(text)
  if (!match) return { text: tidyText(text), tag: null }
  return { text: tidyText(text.slice(match[0].length)), tag: match[1]! }
}

function words(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
}

function shingles(list: string[]) {
  const result = new Set<string>()
  for (let i = 0; i + SHINGLE_SIZE <= list.length; i++) result.add(list.slice(i, i + SHINGLE_SIZE).join(' '))
  return result
}

// Fraction of the Square text's word runs that also appear in the ISBNdb text, or null if the Square text is too short.
export function overlapWithSquare(squareText: string, isbndbText: string): number | null {
  const squareWords = words(squareText)
  if (squareWords.length < MIN_WORDS_TO_COMPARE) return null
  const squareShingles = shingles(squareWords)
  const isbndbShingles = shingles(words(isbndbText))
  let shared = 0
  for (const shingle of squareShingles) if (isbndbShingles.has(shingle)) shared++
  return shared / squareShingles.size
}

function mergeDescriptionRaw(input: { squareDescription: string, isbndbDescription: string | null, series?: string | null }): MergedDescription {
  const notes: string[] = []
  const square = stripPublisherTag(input.squareDescription ?? '')
  const isbndbText = input.isbndbDescription ? tidyText(input.isbndbDescription) : ''
  if (square.tag) notes.push(`Removed the publisher tag "[${square.tag}]" from the Square description.`)

  const looksCutOff = square.text.length >= 900 && !/[.!?"”’…)]$/.test(square.text)
  const squareFallback = (reason: string): MergedDescription => {
    notes.push(reason)
    if (looksCutOff) notes.push('The Square description looks cut off mid-sentence.')
    return { description: square.text, source: square.text ? 'square' : 'none', isbndbCheck: check, overlap, removedPublisherTag: square.tag, looksCutOff, notes }
  }

  let check: IsbndbCheck = 'no_isbndb_text'
  let overlap: number | null = null

  if (!isbndbText) return squareFallback('ISBNdb has no description for this book, so the Square description is used.')

  overlap = square.text ? overlapWithSquare(square.text, isbndbText) : null
  if (overlap === null) {
    check = 'unverified'
    notes.push(square.text
      ? 'The Square description is too short to check the ISBNdb description against.'
      : 'There is no Square description to check the ISBNdb description against.')
    notes.push('Using the ISBNdb description.')
    return { description: isbndbText, source: 'isbndb', isbndbCheck: check, overlap, removedPublisherTag: square.tag, looksCutOff: false, notes }
  }

  if (overlap >= MATCH_THRESHOLD) {
    check = 'match'
    notes.push(`The ISBNdb description matches the Square description (${Math.round(overlap * 100)}% shared wording). Using the ISBNdb description.`)
    return { description: isbndbText, source: 'isbndb', isbndbCheck: check, overlap, removedPublisherTag: square.tag, looksCutOff: false, notes }
  }

  check = 'mismatch'
  return squareFallback(`The ISBNdb description shares only ${Math.round(overlap * 100)}% of its wording with the Square description, so it may be for a different book. Using the Square description instead.`)
}

// The proposal never starts or ends with quote marks and has no "--" (see cleanDescription).
export function mergeDescription(input: { squareDescription: string, isbndbDescription: string | null, series?: string | null }): MergedDescription {
  const merged = mergeDescriptionRaw(input)
  let description = cleanDescription(merged.description)
  const notes = [...merged.notes]
  // A series found in the title goes on a line of its own at the top.
  if (input.series && description && !/^part of the /i.test(description)) {
    description = `Part of the ${input.series} series\n\n${description}`
    notes.push(`Added "Part of the ${input.series} series" at the top.`)
  }
  return { ...merged, description, notes }
}
