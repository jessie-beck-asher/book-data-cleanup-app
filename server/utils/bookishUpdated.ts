// Which bookish items have been updated in Square by this app. One local file per Square environment.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

type BookishUpdated = Record<string, string>

function updatedFile() {
  return join(DATA_DIR, `bookish-updated.${currentEnvironmentName()}.json`)
}

// Item ID -> when it was updated.
export async function readBookishUpdated(): Promise<BookishUpdated> {
  try {
    return JSON.parse(await readFile(updatedFile(), 'utf8'))
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

// Called only after Square has confirmed the update. Saves run one at a time.
let queue: Promise<unknown> = Promise.resolve()
export function markBookishUpdated(itemId: string) {
  const run = async () => {
    const all = await readBookishUpdated()
    all[itemId] = new Date().toISOString()
    await writeJsonAtomic(updatedFile(), all)
  }
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}
