// The owner's saved edits per book, kept in one local file per Square environment. Never sent to Square by saving.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface SavedCrop { zoom: number, cx: number, cy: number }

export interface SavedEdit {
  title: string
  description: string
  categories: string[]
  changeVariation: boolean
  includedImages: string[]
  // The image sent first to Square (its primary image). Null or missing means the first included image in the default order.
  primaryImage?: string | null
  // Image keys marked as the sprayed-edges image; it only changes the name given to the image in Square.
  sprayedEdges?: string[]
  // Words added to the end of an image's name in Square, by image key (for a supporting image that is not sprayed).
  imageNameExtras?: Record<string, string>
  crops: Record<string, SavedCrop>
  savedAt: string
  // Flips to true only after Square confirms an update.
  wasUpdated: boolean
}

type EditsFile = Record<string, SavedEdit>

function editsFile() {
  return join(DATA_DIR, `edits.${currentEnvironmentName()}.json`)
}

export async function readEdits(): Promise<EditsFile> {
  try {
    return JSON.parse(await readFile(editsFile(), 'utf8'))
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

// Saves run one at a time so two quick saves cannot overwrite each other.
let queue: Promise<unknown> = Promise.resolve()
export function saveEdit(itemId: string, edit: Omit<SavedEdit, 'savedAt' | 'wasUpdated'>): Promise<SavedEdit> {
  const run = async () => {
    const all = await readEdits()
    const saved: SavedEdit = { ...edit, savedAt: new Date().toISOString(), wasUpdated: all[itemId]?.wasUpdated ?? false }
    all[itemId] = saved
    await writeJsonAtomic(editsFile(), all)
    return saved
  }
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}

// Called only after Square has confirmed the update.
export function markUpdated(itemId: string) {
  const run = async () => {
    const all = await readEdits()
    if (all[itemId]) all[itemId] = { ...all[itemId], wasUpdated: true }
    await writeJsonAtomic(editsFile(), all)
  }
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}
