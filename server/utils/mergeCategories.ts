// Builds the proposed Square categories. Pure functions with no Nuxt imports so they can be tested on their own.

export const BOOKS_CATEGORY = 'Books'
// The genre categories the owner files books under, in the order the pills are shown.
export const GENRE_CATEGORIES = ['Small Town/Cowboy', 'Romantasy', 'Contemporary', 'Dark Romance', 'Young Adult', 'Sports', 'Historical', 'Science Fiction', 'Paranormal', 'Cookbooks'] as const
type Genre = (typeof GENRE_CATEGORIES)[number]

// Subjects (ISBNdb) or categories (Google Books) that point to a genre. Matched as lowercase text inside the subject.
const SUBJECT_HINTS: Record<Genre, string[]> = {
  'Small Town/Cowboy': ['cowboy', 'cowgirl', 'ranch', 'western', 'small town', 'small-town'],
  'Romantasy': [],
  'Contemporary': ['contemporary'],
  'Dark Romance': ['dark romance', 'mafia', 'dark fiction'],
  // Only a "Young Adult" subject counts (this includes "Teen & Young Adult"); looser words like "juvenile" or "teen" matched too many adult books.
  'Young Adult': ['young adult'],
  'Sports': ['sports', 'hockey', 'football', 'baseball', 'basketball'],
  'Historical': [],
  'Science Fiction': [],
  'Paranormal': [],
  'Cookbooks': []
}

// Genres that were often suggested wrongly. When Google Books has data for a book, these need Google to agree.
const NEEDS_CONFIRMATION: Genre[] = ['Romantasy', 'Historical', 'Young Adult']
// When only one genre is kept and several qualify, the more specific one wins.
const SPECIFICITY: Genre[] = ['Dark Romance', 'Small Town/Cowboy', 'Sports', 'Science Fiction', 'Paranormal', 'Romantasy', 'Historical', 'Young Adult', 'Cookbooks', 'Contemporary']

// Words in a title or description that give away Romantasy even when the subjects don't say fantasy. Add more here as they turn up.
// "King" is left out on purpose: in this catalog it mostly means a billionaire, a mafia boss, a surname or "king crab", so it matched too many contemporary books.
const ROMANTASY_WORDS = /\bkingdoms?\b/i

function genresFrom(texts: string[]): Set<Genre> {
  const subjects = texts.map(text => text.toLowerCase())
  const matches = new Set<Genre>()
  for (const genre of GENRE_CATEGORIES) {
    // A subject that is the genre's own name is always a match, on top of the hints.
    if ([genre.toLowerCase(), ...SUBJECT_HINTS[genre]].some(hint => subjects.some(subject => subject.includes(hint)))) matches.add(genre)
  }
  // Fantasy, alone or with romance, is how this shop uses "Romantasy".
  if (subjects.some(subject => subject.includes('fantasy'))) matches.add('Romantasy')
  return matches
}

export interface MergedCategories {
  // Names to pre-select, always including "Books".
  selected: string[]
  // Genres taken from ISBNdb subjects, as opposed to ones the item already has in Square.
  suggested: string[]
  notes: string[]
}

export function mergeCategories(input: {
  squareCategories: string[]
  isbndbSubjects: string[]
  // Categories Google Books gave for this exact ISBN, or null when there is no Google data for the book.
  googleCategories?: string[] | null
  // The short title and the description, searched for Romantasy giveaway words.
  titleText?: string
  descriptionText?: string
}): MergedCategories {
  const notes: string[] = []
  const selected = new Set<string>([BOOKS_CATEGORY])
  const suggested: string[] = []

  const existing = GENRE_CATEGORIES.filter(genre => input.squareCategories.includes(genre))
  if (existing.length) {
    for (const genre of existing) selected.add(genre)
    notes.push(`Kept the genre already set in Square: ${existing.join(', ')}.`)
  } else {
    const fromIsbndb = genresFrom(input.isbndbSubjects)
    const giveaway = ROMANTASY_WORDS.exec(`${input.titleText ?? ''}\n${input.descriptionText ?? ''}`)
    if (giveaway && !fromIsbndb.has('Romantasy')) {
      fromIsbndb.add('Romantasy')
      notes.push(`Romantasy added because the title or description mentions "${giveaway[0]}".`)
    }
    let chosen: Genre[]

    // A Google answer that names no genre (usually just "Fiction") says nothing, so it is not used as a check.
    const fromGoogle = genresFrom(input.googleCategories ?? [])
    if (input.googleCategories && fromGoogle.size) {
      // Google Books is a check on ISBNdb: genres both agree on are kept (more than one only when both agree on each).
      const agreed = GENRE_CATEGORIES.filter(genre => fromIsbndb.has(genre) && fromGoogle.has(genre))
      notes.push(`Google Books says: ${input.googleCategories.join('; ')}.`)
      if (agreed.length) {
        chosen = agreed
        notes.push(`ISBNdb and Google Books agree on: ${agreed.join(', ')}.`)
      } else {
        // No agreement: lean towards a single genre from ISBNdb, leaving out the ones Google did not confirm.
        const unconfirmed = [...fromIsbndb].filter(genre => NEEDS_CONFIRMATION.includes(genre))
        const keep = SPECIFICITY.find(genre => fromIsbndb.has(genre) && !NEEDS_CONFIRMATION.includes(genre))
        chosen = keep ? [keep] : []
        if (unconfirmed.length) notes.push(`Left out ${unconfirmed.join(', ')}: ISBNdb suggested it but Google Books did not confirm.`)
      }
    } else {
      chosen = GENRE_CATEGORIES.filter(genre => fromIsbndb.has(genre))
    }

    for (const genre of chosen) {
      selected.add(genre)
      suggested.push(genre)
    }
    notes.push(suggested.length
      ? `No genre in Square. Suggested: ${suggested.join(', ')}.`
      : 'No genre in Square, and the book data did not point to one. Pick one if it fits.')
  }

  if (!input.squareCategories.includes(BOOKS_CATEGORY)) notes.push('Added "Books", which every book with an ISBN should have.')
  return { selected: [BOOKS_CATEGORY, ...GENRE_CATEGORIES.filter(genre => selected.has(genre))], suggested, notes }
}
