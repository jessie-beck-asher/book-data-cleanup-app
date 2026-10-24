// Builds the proposed Square categories. Pure functions with no Nuxt imports so they can be tested on their own.

export const BOOKS_CATEGORY = 'Books'
// The genre categories the owner files books under, in the order the pills are shown.
export const GENRE_CATEGORIES = ['Small Town/Cowboy', 'Romantasy', 'Contemporary', 'Dark Romance', 'Young Adult', 'Sports'] as const

// ISBNdb subjects that point to a genre. Matched as lowercase text inside a subject.
const SUBJECT_HINTS: Record<(typeof GENRE_CATEGORIES)[number], string[]> = {
  'Small Town/Cowboy': ['cowboy', 'cowgirl', 'ranch', 'western', 'small town', 'small-town'],
  'Romantasy': [],
  'Contemporary': ['contemporary'],
  'Dark Romance': ['dark romance', 'mafia', 'dark fiction'],
  'Young Adult': ['young adult', 'juvenile', 'teen'],
  'Sports': ['sports', 'hockey', 'football', 'baseball', 'basketball']
}

export interface MergedCategories {
  // Names to pre-select, always including "Books".
  selected: string[]
  // Genres taken from ISBNdb subjects, as opposed to ones the item already has in Square.
  suggested: string[]
  notes: string[]
}

export function mergeCategories(input: { squareCategories: string[], isbndbSubjects: string[] }): MergedCategories {
  const notes: string[] = []
  const selected = new Set<string>([BOOKS_CATEGORY])
  const suggested: string[] = []

  const existing = GENRE_CATEGORIES.filter(genre => input.squareCategories.includes(genre))
  if (existing.length) {
    for (const genre of existing) selected.add(genre)
    notes.push(`Kept the genre already set in Square: ${existing.join(', ')}.`)
  } else {
    const subjects = input.isbndbSubjects.map(subject => subject.toLowerCase())
    const matches = new Set<(typeof GENRE_CATEGORIES)[number]>()
    for (const genre of GENRE_CATEGORIES) {
      if (SUBJECT_HINTS[genre].some(hint => subjects.some(subject => subject.includes(hint)))) matches.add(genre)
    }
    // Fantasy and romance together is how this shop uses "Romantasy".
    if (subjects.some(subject => subject.includes('fantasy')) && subjects.some(subject => subject.includes('romance'))) matches.add('Romantasy')

    for (const genre of GENRE_CATEGORIES) {
      if (!matches.has(genre)) continue
      selected.add(genre)
      suggested.push(genre)
    }
    notes.push(suggested.length
      ? `No genre in Square. Suggested from ISBNdb subjects: ${suggested.join(', ')}.`
      : 'No genre in Square, and the ISBNdb subjects did not point to one. Pick one if it fits.')
  }

  if (!input.squareCategories.includes(BOOKS_CATEGORY)) notes.push('Added "Books", which every book with an ISBN should have.')
  return { selected: [BOOKS_CATEGORY, ...GENRE_CATEGORIES.filter(genre => selected.has(genre))], suggested, notes }
}
