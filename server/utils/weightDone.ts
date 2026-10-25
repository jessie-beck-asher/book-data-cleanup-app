// Which books the owner has ticked as "shipping weight added by hand in Square". One local file per Square environment.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

type WeightDone = Record<string, true>

function weightDoneFile() {
  return join(DATA_DIR, `weight-done.${currentEnvironmentName()}.json`)
}

export async function readWeightDone(): Promise<WeightDone> {
  try {
    return JSON.parse(await readFile(weightDoneFile(), 'utf8'))
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

// Saves run one at a time so two quick clicks cannot overwrite each other.
let queue: Promise<unknown> = Promise.resolve()
export function setWeightDone(itemId: string, done: boolean) {
  const run = async () => {
    const all = await readWeightDone()
    if (done) all[itemId] = true
    else delete all[itemId]
    await writeJsonAtomic(weightDoneFile(), all)
  }
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}
