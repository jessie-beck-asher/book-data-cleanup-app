// The owner's saved edits per book, kept in one local file per Square environment. Never sent to Square by saving.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { looksSprayed, parseImageName } from '../../shared/imageNames.ts'

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
  // True once the saved image choices point at the item's current Square images (see syncSavedImages).
  imagesSynced?: boolean
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
    const saved: SavedEdit = { ...edit, savedAt: new Date().toISOString(), wasUpdated: all[itemId]?.wasUpdated ?? false, imagesSynced: all[itemId]?.imagesSynced }
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

// After an update, Square gives the uploaded images new IDs and the old ones are gone, so the saved image choices (which point at the old
// IDs, the ISBNdb cover and uploads) no longer describe the item. Without this the next plan would delete the images now in Square and send
// the same ones again. This points the saved choices at the item's current Square images, in their order, keeping their names' marks.
// `onlyIfStale` is for books updated before this existed: it changes nothing unless the saved choices look left over from an update.
export function syncSavedImages(itemId: string, options: { onlyIfStale?: boolean } = {}): Promise<boolean> {
  const run = async () => {
    const all = await readEdits()
    const edit = all[itemId]
    const snapshot = await readSnapshot()
    const item = snapshot?.items.find(candidate => candidate.id === itemId)
    if (!edit || !item) return false
    const ids: string[] = item.item_data?.image_ids ?? []

    if (options.onlyIfStale) {
      const stale = edit.includedImages.some(key => key.startsWith('square:') ? !ids.includes(key.slice('square:'.length)) : true)
      if (!stale) {
        all[itemId] = { ...edit, imagesSynced: true }
        await writeJsonAtomic(editsFile(), all)
        return false
      }
    }

    const names = new Map(snapshot!.relatedObjects.map(object => [object.id as string, object.image_data?.name as string | undefined]))
    const sprayedEdges: string[] = []
    const imageNameExtras: Record<string, string> = {}
    for (const id of ids) {
      const key = `square:${id}`
      const parsed = parseImageName(names.get(id), edit.title)
      if (parsed?.sprayedEdges || (!parsed && looksSprayed(names.get(id)))) sprayedEdges.push(key)
      if (parsed?.extra) imageNameExtras[key] = parsed.extra
    }
    all[itemId] = {
      ...edit,
      includedImages: ids.map(id => `square:${id}`),
      // Square keeps the first image as the primary one, so the order already says which it is.
      primaryImage: null,
      sprayedEdges,
      imageNameExtras,
      crops: {},
      imagesSynced: true
    }
    await writeJsonAtomic(editsFile(), all)
    return true
  }
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}
