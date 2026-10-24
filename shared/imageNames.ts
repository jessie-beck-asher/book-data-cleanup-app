// How images are named in Square: the book title without the author, with dashes between words, then "-book-cover",
// plus "-sprayed-edges" for an image the owner marks as the sprayed-edges edition.

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

export function imageNameFor(title: string, sprayedEdges: boolean) {
  const base = slugify(titleWithoutAuthor(title)) || 'book'
  return `${base}-book-cover${sprayedEdges ? '-sprayed-edges' : ''}`
}

// The caption (Square shows it as the image's alt text) is the image name with spaces instead of dashes.
export const imageCaptionFor = (name: string) => name.replace(/-/g, ' ')

// A Square image already named with "sprayed-edges" starts out marked.
export const looksSprayed = (name: string | undefined) => /sprayed/i.test(name ?? '')
