// Shipping weights (pounds) the owner types in for bookish items. One local file per Square environment, kept apart from the
// Square snapshot so a re-pull never wipes them. Not sent to Square.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

type BookishWeights = Record<string, { pounds: number, savedAt: string }>

function weightsFile() {
  return join(DATA_DIR, `bookish-weights.${currentEnvironmentName()}.json`)
}

export async function readBookishWeights(): Promise<BookishWeights> {
  try {
    return JSON.parse(await readFile(weightsFile(), 'utf8'))
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

// Saves run one at a time so two quick edits cannot overwrite each other. null clears the weight.
let queue: Promise<unknown> = Promise.resolve()
export function setBookishWeight(itemId: string, pounds: number | null) {
  const run = async () => {
    const all = await readBookishWeights()
    if (pounds === null) delete all[itemId]
    else all[itemId] = { pounds, savedAt: new Date().toISOString() }
    await writeJsonAtomic(weightsFile(), all)
  }
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}
