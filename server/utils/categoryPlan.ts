// The owner's free-form category plan: a tree of names, saved as one local file. Does not touch Square.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface CategoryPlanNode {
  id: string
  name: string
  children: CategoryPlanNode[]
}

const MAX_NODES = 2000
const MAX_DEPTH = 8

function planFile() {
  return join(DATA_DIR, 'category-plan.json')
}

export async function readCategoryPlan(): Promise<CategoryPlanNode[]> {
  try {
    return JSON.parse(await readFile(planFile(), 'utf8')).nodes ?? []
  } catch (error: any) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

// Rebuilds the tree from untrusted input, keeping only id, name and children.
export function cleanCategoryPlan(input: unknown): CategoryPlanNode[] {
  let count = 0
  const clean = (list: unknown, depth: number): CategoryPlanNode[] => {
    if (!Array.isArray(list) || depth > MAX_DEPTH) throw createError({ statusCode: 400, statusMessage: 'Bad category plan' })
    return list.map((node: any) => {
      if (typeof node?.id !== 'string' || typeof node?.name !== 'string' || ++count > MAX_NODES) {
        throw createError({ statusCode: 400, statusMessage: 'Bad category plan' })
      }
      return { id: node.id, name: node.name.slice(0, 200), children: clean(node.children ?? [], depth + 1) }
    })
  }
  return clean(input, 1)
}

// Saves run one at a time so two quick edits cannot overwrite each other.
let queue: Promise<unknown> = Promise.resolve()
export function writeCategoryPlan(nodes: CategoryPlanNode[]) {
  const run = () => writeJsonAtomic(planFile(), { nodes })
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}
