import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const DATA_DIR = join(process.cwd(), 'data')

// Write to a temp file, then rename, so a crash never leaves a half-written file.
export async function writeJsonAtomic(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true })
  const tempFile = `${file}.tmp`
  await writeFile(tempFile, JSON.stringify(value, null, 2))
  await rename(tempFile, file)
}
