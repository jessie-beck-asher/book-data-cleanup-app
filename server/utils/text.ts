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

const NOT_A_SENTENCE_END = /(?:\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Mt|vs|etc|No)|\b\p{Lu})\.$/u

// Splits on ". " / "? " / "! " (a closing quote or bracket may follow) when a capital letter, digit or opening quote comes next.
function splitSentences(paragraph: string): string[] {
  const sentences: string[] = []
  let start = 0
  for (const match of paragraph.matchAll(/[.!?…]["”’)]*\s+(?=["“‘(]?[\p{Lu}\d])/gu)) {
    const end = match.index + match[0].trimEnd().length
    if (NOT_A_SENTENCE_END.test(paragraph.slice(start, end))) continue
    sentences.push(paragraph.slice(start, end))
    start = match.index + match[0].length
  }
  sentences.push(paragraph.slice(start))
  return sentences
}

// A single-block paragraph of 6+ sentences gets blank lines, in groups of 4-5 sentences (3 each for 6, 5 and 4 for 9, ...).
// Paragraphs that already have line breaks are left as written.
export function breakLongParagraph(paragraph: string): string {
  if (paragraph.includes('\n')) return paragraph
  const sentences = splitSentences(paragraph)
  if (sentences.length < 6) return paragraph
  const groups = Math.ceil(sentences.length / 5)
  const size = Math.ceil(sentences.length / groups)
  const parts: string[] = []
  for (let i = 0; i < sentences.length; i += size) parts.push(sentences.slice(i, i + size).join(' '))
  return parts.join('\n\n')
}

// For descriptions going to Square: drops "- Provided by publisher." wherever it appears (ISBNdb usually has it right after
// the closing quote, like `...ablaze?"-- Provided by publisher.`), drops quote marks (and a trailing "--") at the very
// start and end, turns "--" into "-", ends the text with a period if it has no closing punctuation, and breaks up
// huge paragraphs.
export function cleanDescription(text: string): string {
  const cleaned = tidyText(text.replace(/[ \t]*[-–—]*[ \t]*provided\s+by\s+(?:the\s+)?publisher\.?[ \t]*/gi, ''))
    .replace(/^["“”]+\s*/, '')
    .replace(/\s*["“”]+[-–—]*\s*$/, '')
    .replace(/\s*-{2,}\s*$/, '')
    .replace(/-{2,}/g, '-')
    .trim()
  if (!cleaned) return cleaned
  const ended = /[.!?…]["”’)]*$/.test(cleaned) ? cleaned : `${cleaned}.`
  return ended.split(/\n{2,}/).map(breakLongParagraph).join('\n\n')
}
