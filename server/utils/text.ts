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
export function breakLongParagraph(paragraph: string): string {
  const sentences = splitSentences(paragraph)
  if (sentences.length < 6) return paragraph
  const groups = Math.ceil(sentences.length / 5)
  const size = Math.ceil(sentences.length / groups)
  const parts: string[] = []
  for (let i = 0; i < sentences.length; i += size) parts.push(sentences.slice(i, i + size).join(' '))
  return parts.join('\n\n')
}

// A short line with no sentence ending ("Plus size FMC", "Tropes:") is a list item. Two or more in a row stay on consecutive lines.
const isListLine = (line: string) => line.length <= 60 && !/[.!?…]["”’)]*$/.test(line)

// Lines separated by a single break: runs of list items keep single breaks, everything else becomes its own spaced paragraph.
function spaceLines(block: string): { text: string, endsWithList: boolean } {
  const parts: string[] = []
  let run: string[] = []
  const flush = () => { if (run.length) parts.push(run.join('\n')); run = [] }
  for (const line of block.split('\n')) {
    if (isListLine(line)) { run.push(line); continue }
    flush()
    parts.push(line)
  }
  const endsWithList = run.length > 1
  flush()
  return { text: parts.join('\n\n'), endsWithList }
}

// Leftover from the cover text: `"-Page 4 of cover.`
const TRAILING_COVER_NOTE = /\s*["“”]*\s*[-–—]*\s*page\s+\d+\s+of\s+(?:the\s+)?cover\.?["“”]*\s*$/i
const TRAILING_BRACKETS = /\s*\[[^\[\]]*\]\.?\s*$/

// For descriptions going to Square: drops "- Provided by publisher." wherever it appears (ISBNdb usually has it right after
// the closing quote, like `...ablaze?"-- Provided by publisher.`), drops quote marks (and a trailing "--") at the very
// start and end, adds a space after a period that is jammed against the next sentence, puts a blank line between paragraph lines (but not between the short lines of a list), turns "--" and em dashes into "-", turns ". . ." into "...", ends the text with a period if it has no closing punctuation, and breaks up
// huge paragraphs.
export function cleanDescription(text: string): string {
  let cleaned = tidyText(text.replace(/[ \t]*[-–—]*[ \t]*provided\s+by\s+(?:the\s+)?publisher\.?[ \t]*/gi, ''))
    .replace(/^["“”]+\s*/, '')
    .replace(/\s*["“”]+[-–—]*\s*$/, '')
    .replace(/\s*-{2,}\s*$/, '')
    .replace(/-{2,}/g, '-')
    // Sentences run together ("end.The next") get a space after the period, question mark or exclamation mark.
    // A capital followed by a period ("Ph.D.", "J.R.") is an abbreviation, not a new sentence.
    .replace(/(\.{3}|…|[\p{Ll}\d][.!?])(["”’)]?)(?=\p{Lu}(?!\.))/gu, '$1$2 ')
    .replace(/([\p{Ll}\d][.!?])(?=[“‘]\p{Lu})/gu, '$1 ')
    // Spaced-out dots (". . .") become a plain ellipsis, and an em dash becomes a single dash.
    .replace(/\.(?: \.){2,}/g, '...')
    .replace(/—/g, '-')
    .trim()
  if (!cleaned) return cleaned
  // A single line break between lines becomes a blank line so each is its own spaced paragraph, except short list lines (see spaceLines).
  // Bracketed text ("[ text ]", "[text].") and a "-Page 4 of cover." note at the very end of a paragraph are dropped.
  cleaned = cleaned.split('\n').map(line => line.replace(TRAILING_COVER_NOTE, '').replace(TRAILING_BRACKETS, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!cleaned) return cleaned
  const blocks = cleaned.split(/\n{2,}/).map(spaceLines)
  const listEnd = blocks[blocks.length - 1]!.endsWithList
  cleaned = blocks.map(block => block.text).join('\n\n')
  // A list at the very end is left as it is, without a period added after the last item.
  const ended = listEnd || /[.!?…]["”’)]*$/.test(cleaned) ? cleaned : `${cleaned}.`
  return ended.split(/\n{2,}/).map(breakLongParagraph).join('\n\n')
}
