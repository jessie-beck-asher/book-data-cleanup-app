// How images are named in Square: the book title without the author, with dashes between words, then "-book-cover",
// plus "-sprayed-edges" for an image the owner marks as the sprayed-edges edition, plus any words the owner adds.

export function slugify(text: string) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Titles are written "Title by Author". The author is dropped: everything from the last " by " on.
export function titleWithoutAuthor(title: string) {
  const at = title.toLowerCase().lastIndexOf(' by ')
  const head = at > 0 ? title.slice(0, at).trim() : title
  return head || title
}

// `extra` is words the owner adds for a supporting image (such as "back cover"); they go on the very end.
export function imageNameFor(title: string, sprayedEdges: boolean, extra = '') {
  const base = slugify(titleWithoutAuthor(title)) || 'book'
  const more = slugify(extra)
  return `${base}-book-cover${sprayedEdges ? '-sprayed-edges' : ''}${more ? `-${more}` : ''}`
}

// The caption (Square shows it as the image's alt text) is the image name with spaces instead of dashes.
export const imageCaptionFor = (name: string) => name.replace(/-/g, ' ')

// A Square image already named with "sprayed-edges" starts out marked.
export const looksSprayed = (name: string | undefined) => /sprayed/i.test(name ?? '')

// The reverse of imageNameFor: reads the sprayed-edges mark and the added words back out of a name already in Square.
// Returns null when the name does not start with this title's usual "title-book-cover".
export function parseImageName(name: string | undefined, title: string): { sprayedEdges: boolean, extra: string } | null {
  const prefix = `${slugify(titleWithoutAuthor(title)) || 'book'}-book-cover`
  if (!name || !name.startsWith(prefix)) return null
  let rest = name.slice(prefix.length)
  if (rest && !rest.startsWith('-')) return null
  const sprayedEdges = rest.startsWith('-sprayed-edges')
  if (sprayedEdges) rest = rest.slice('-sprayed-edges'.length)
  return { sprayedEdges, extra: rest.replace(/^-+/, '').replace(/-/g, ' ') }
}
