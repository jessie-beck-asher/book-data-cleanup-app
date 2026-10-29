// Alt text drafts written by the AI, kept on this computer so a reload does not lose (or re-buy) them. Image ID -> draft.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

type Drafts = Record<string, { alt: string, writtenAt: string }>

function draftsFile() {
  return join(DATA_DIR, `alt-text-drafts.${currentEnvironmentName()}.json`)
}

export async function readAltDrafts(): Promise<Drafts> {
  try {
    return JSON.parse(await readFile(draftsFile(), 'utf8'))
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

let queue: Promise<unknown> = Promise.resolve()
export function saveAltDrafts(drafts: Record<string, string>) {
  const run = async () => {
    const all = await readAltDrafts()
    const writtenAt = new Date().toISOString()
    for (const [id, alt] of Object.entries(drafts)) all[id] = { alt, writtenAt }
    await writeJsonAtomic(draftsFile(), all)
  }
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}
