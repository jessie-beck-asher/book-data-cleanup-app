// Items the owner has marked "needs a talk with the book owner". One local file per Square environment. Not sent to Square.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

type Flags = Record<string, string>

function flagsFile() {
  return join(DATA_DIR, `flagged.${currentEnvironmentName()}.json`)
}

// Item ID -> when it was marked.
export async function readFlags(): Promise<Flags> {
  try {
    return JSON.parse(await readFile(flagsFile(), 'utf8'))
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

// Saves run one at a time so two quick clicks cannot overwrite each other.
let queue: Promise<unknown> = Promise.resolve()
export function setFlag(itemId: string, flagged: boolean) {
  const run = async () => {
    const all = await readFlags()
    if (flagged) all[itemId] = new Date().toISOString()
    else delete all[itemId]
    await writeJsonAtomic(flagsFile(), all)
  }
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}
