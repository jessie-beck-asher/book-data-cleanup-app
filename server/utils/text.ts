const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': '\'',
  '&nbsp;': ' '
}

// Rough HTML-to-plain-text for display. The real conversion rules are to be worked out with the owner.
export function htmlToPlainText(html: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, entity => ENTITIES[entity] ?? entity)
  return tidyText(text)
}

// Removes stray spaces around line breaks and collapses runs of blank lines.
export function tidyText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// For descriptions going to Square: drops quote marks (and a trailing "--") at the very start and end, and turns "--" into "-".
export function cleanDescription(text: string): string {
  return tidyText(text)
    .replace(/^["“”]+\s*/, '')
    .replace(/\s*["“”]+[-–—]*\s*$/, '')
    .replace(/\s*-{2,}\s*$/, '')
    .replace(/-{2,}/g, '-')
    .trim()
}
