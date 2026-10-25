// Builds the proposed Square title: "Title (Special Edition) by Author Name (Paperback)".
// Pure functions with no Nuxt imports so they can be tested on their own.

const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'for', 'of', 'in', 'on', 'at', 'to', 'by'])

const ORDINALS = 'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|fifteenth|twentieth|twenty-fifth|thirtieth|fortieth|fiftieth|hundredth'
const QUALIFIER = String.raw`special|deluxe|illustrated|signed|collector['’]?s|(?:(?:\d+(?:st|nd|rd|th)|${ORDINALS})[\s-]+)?anniversary`
// An edition counts only when the word "Edition" follows the qualifier.
const EDITION_SOURCE = String.raw`\(?\b(${QUALIFIER})\s+edition\b\)?`

export interface MergedTitle {
  title: string
  base: string
  edition: string | null
  format: string | null
  authors: string | null
  // A bracketed name in the title that is not an edition or a format, such as "(Wicked Villains)".
  series: string | null
  notes: string[]
}

export interface MergeTitleInput {
  squareTitle: string
  squareDescription: string
  isbndb?: { title?: string | null, synopsis?: string | null, authors?: string[], binding?: string | null } | null
}

function capitalizeParts(word: string) {
  // Parts starting with a digit (like "10th") are left alone.
  return word.split('-').map(part => /^\d/.test(part) ? part : part.replace(/\p{L}/u, letter => letter.toUpperCase())).join('-')
}

// Small words stay lowercase unless first in the title or right after a colon. Other letters are left as typed.
export function titleCase(text: string) {
  const hasLetters = /[A-Za-z]/.test(text)
  const source = hasLetters && text === text.toUpperCase() ? text.toLowerCase() : text
  const words = source.split(/\s+/).filter(Boolean)
  return words.map((word, index) => {
    const afterColon = index > 0 && words[index - 1]!.endsWith(':')
    if (index > 0 && !afterColon && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase()
    return capitalizeParts(word)
  }).join(' ')
}

function stripTags(html: string) {
  return html.replace(/<[^>]*>/g, ' ')
}

function findEdition(text: string | null | undefined): string | null {
  if (!text) return null
  const match = new RegExp(EDITION_SOURCE, 'i').exec(text)
  if (!match) return null
  const words = match[1]!.split(/\s+/).map(capitalizeParts)
  return `${words.join(' ')} Edition`
}

// ISBNdb's binding field is free text ("Mass Market Paperback", "Hardcover", ...). Anything else gets no label.
function bindingToFormat(binding: string | null | undefined): string | null {
  if (!binding) return null
  if (/paperback|softcover|soft cover|trade paper/i.test(binding)) return 'Paperback'
  if (/hardcover|hard cover|hardback|hardbound/i.test(binding)) return 'Hardcover'
  return null
}

// Brackets in a title that name neither an edition nor a format are taken to be the series.
const FORMAT_WORDS = /^(?:paperback|hardcover|hardback|hardbound|softcover|soft cover|mass market(?: paperback)?|trade paperback|large print|board book)$/i
function findSeries(text: string | null | undefined): string | null {
  if (!text) return null
  for (const match of text.matchAll(/\(([^()]+)\)/g)) {
    const inner = match[1]!.trim()
    if (new RegExp(EDITION_SOURCE, 'i').test(inner) || /\bedition\b/i.test(inner) || FORMAT_WORDS.test(inner)) continue
    // "Wicked Villains, Book 2" and "Wicked Villains #2" both mean the series is "Wicked Villains".
    const name = inner.replace(/[,;:]?\s*(?:book|vol(?:ume)?\.?|part)?\s*#?\d+\s*$/i, '').replace(/\s+series$/i, '').trim()
    if (name && /\p{L}/u.test(name)) return name
  }
  return null
}

function removeEditions(text: string) {
  return text
    .replace(new RegExp(EDITION_SOURCE, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:,\-–—|]+|[\s:,\-–—|]+$/g, '')
}

// ISBNdb gives "Last, First"; Square wants "First Last".
function flipName(name: string) {
  const comma = name.indexOf(',')
  if (comma === -1) return name.trim()
  return `${name.slice(comma + 1).trim()} ${name.slice(0, comma).trim()}`.trim()
}

function joinAuthors(names: string[]) {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// Fallback when ISBNdb has no authors: Square titles look like "Title by Author Name".
function splitTrailingAuthor(title: string): { base: string, author: string | null } {
  const index = title.toLowerCase().lastIndexOf(' by ')
  if (index === -1) return { base: title, author: null }
  const rest = title.slice(index + 4).trim()
  const words = rest.split(/\s+/)
  const looksLikeName = words.length >= 2 && words.length <= 8 && words.every(word => /^[\p{Lu}]/u.test(word))
  return looksLikeName ? { base: title.slice(0, index), author: rest } : { base: title, author: null }
}

export function mergeTitle(input: MergeTitleInput): MergedTitle {
  const notes: string[] = []
  const isbndb = input.isbndb ?? null

  const editionSources: [string, string | null | undefined][] = [
    ['the ISBNdb title', isbndb?.title],
    ['the Square title', input.squareTitle],
    ['the ISBNdb description', isbndb?.synopsis ? stripTags(isbndb.synopsis) : null],
    ['the Square description', input.squareDescription]
  ]
  let edition: string | null = null
  for (const [label, text] of editionSources) {
    edition = findEdition(text)
    if (edition) {
      notes.push(`Edition "${edition}" found in ${label}.`)
      break
    }
  }

  let rawBase: string
  let author: string | null = null
  const isbndbAuthors = (isbndb?.authors ?? []).map(flipName).filter(Boolean)

  if (isbndb?.title) {
    rawBase = isbndb.title
    notes.push('Title taken from ISBNdb.')
  } else {
    rawBase = input.squareTitle
    notes.push('No ISBNdb title, so the title was taken from Square.')
  }

  if (isbndbAuthors.length) {
    author = joinAuthors(isbndbAuthors)
    notes.push('Author taken from ISBNdb.')
  } else {
    const split = splitTrailingAuthor(rawBase)
    rawBase = split.base
    // The Square title is the fallback source for the author even when the base title came from ISBNdb.
    author = split.author ?? splitTrailingAuthor(input.squareTitle).author
    notes.push(author ? 'No ISBNdb author, so the author was taken from the end of the Square title.' : 'No author found.')
  }

  const format = bindingToFormat(isbndb?.binding)
  if (format) notes.push(`Format "${format}" from the ISBNdb binding "${isbndb?.binding}".`)
  else if (isbndb?.binding) notes.push(`ISBNdb binding "${isbndb.binding}" is not Paperback or Hardcover, so no format was added.`)
  else notes.push('ISBNdb has no binding for this book, so no format was added.')

  const series = findSeries(input.squareTitle) ?? findSeries(isbndb?.title)
  if (series) notes.push(`A series, "${series}", was found in brackets in the title.`)

  const base = titleCase(removeEditions(rawBase))
  const title = [base, edition ? `(${edition})` : null, author ? `by ${author}` : null, format ? `(${format})` : null].filter(Boolean).join(' ')
  return { title, base, edition, format, authors: author, series, notes }
}
