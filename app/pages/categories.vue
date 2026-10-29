<script setup lang="ts">
interface PlanNode { id: string, name: string, children: PlanNode[] }

const { data } = await useFetch<{ nodes: PlanNode[] }>('/api/category-plan')
const nodes = ref<PlanNode[]>(data.value?.nodes ?? [])
const saveError = ref('')
const savedAt = ref<Date | null>(null)

// Every change saves the whole tree to the local file, a moment after the last change.
let timer: ReturnType<typeof setTimeout> | undefined
async function saveNow() {
  try {
    await $fetch('/api/category-plan', { method: 'PUT', body: { nodes: nodes.value } })
    saveError.value = ''
    savedAt.value = new Date()
  } catch (error: any) {
    saveError.value = error?.data?.statusMessage ?? 'Could not save the plan'
  }
}
function save() {
  clearTimeout(timer)
  timer = setTimeout(saveNow, 300)
}
provide('savePlan', save)

const adding = ref(false)
const draft = ref('')
function finishAdd(keepGoing = false) {
  if (!adding.value) return
  const name = draft.value.trim()
  if (name) {
    nodes.value.push({ id: crypto.randomUUID(), name, children: [] })
    save()
  }
  draft.value = ''
  adding.value = keepGoing
}
</script>

<template>
  <div>
    <h1>Categories</h1>
    <p class="hint">
      A planning space for the category tree. Nothing here is sent to Square.
      Hover a row for options; double-click a name to rename it.
    </p>
    <section class="panel">
      <div class="panel-head">
        <h2>Category plan</h2>
        <button type="button" class="create" @click="adding = true; draft = ''">Create new</button>
      </div>
      <ul class="tree">
        <CategoryNode v-for="node in nodes" :key="node.id" :node="node" :siblings="nodes" />
        <li v-if="adding" class="tree-add">
          <input
            v-model="draft"
            class="cat-input"
            placeholder="New parent category name"
            @vue:mounted="($event.el as HTMLInputElement).focus()"
            @keydown.enter="finishAdd(true)"
            @keydown.esc="adding = false"
            @blur="finishAdd(false)"
          >
        </li>
      </ul>
      <p v-if="!nodes.length && !adding" class="empty">No categories yet. Press "Create new" to add a parent category.</p>
      <p v-if="saveError" class="error">{{ saveError }}</p>
      <p v-else-if="savedAt" class="saved">Saved locally at {{ savedAt.toLocaleTimeString() }}</p>
    </section>
  </div>
</template>

<style scoped>
.hint { color: #555; }
.panel { max-width: 44rem; padding: 1.25rem 1.5rem; background: #fff; border-radius: 0.75rem; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12); }
.panel-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 0.75rem; }
.panel-head h2 { margin: 0; font-size: 1.3rem; }
.create { margin: 0; border: 0; background: none; color: #1558b0; font-size: 1rem; cursor: pointer; }
.tree { margin: 0; padding: 0; }
.tree-add { list-style: none; padding: 0.3rem 0.5rem 0.3rem 1.8rem; }
.cat-input { font: inherit; padding: 0.15rem 0.4rem; min-width: 16rem; }
.empty { color: #666; }
.saved { color: #666; font-size: 0.85rem; margin-bottom: 0; }
</style>
