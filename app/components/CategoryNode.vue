<script setup lang="ts">
interface PlanNode { id: string, name: string, children: PlanNode[] }

const props = defineProps<{ node: PlanNode, siblings: PlanNode[] }>()
const save = inject<() => void>('savePlan', () => {})

const open = ref(true)
const editing = ref(false)
const adding = ref(false)
const draft = ref('')
const hasChildren = computed(() => props.node.children.length > 0)

function newId() {
  return crypto.randomUUID()
}
function startRename() {
  draft.value = props.node.name
  editing.value = true
}
function finishRename() {
  if (!editing.value) return
  editing.value = false
  const name = draft.value.trim()
  if (name && name !== props.node.name) {
    props.node.name = name
    save()
  }
}
function startAdd() {
  draft.value = ''
  open.value = true
  adding.value = true
}
function finishAdd(keepGoing = false) {
  if (!adding.value) return
  const name = draft.value.trim()
  if (name) {
    props.node.children.push({ id: newId(), name, children: [] })
    save()
  }
  draft.value = ''
  adding.value = keepGoing
}
function remove() {
  const count = countAll(props.node) - 1
  const warning = count > 0 ? `Delete "${props.node.name}" and the ${count} categories inside it?` : `Delete "${props.node.name}"?`
  if (!window.confirm(warning)) return
  props.siblings.splice(props.siblings.indexOf(props.node), 1)
  save()
}
function countAll(node: PlanNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countAll(child), 0)
}
function move(direction: -1 | 1) {
  const from = props.siblings.indexOf(props.node)
  const to = from + direction
  if (to < 0 || to >= props.siblings.length) return
  props.siblings.splice(to, 0, props.siblings.splice(from, 1)[0]!)
  save()
}
</script>

<template>
  <li class="cat-node">
    <div class="cat-row">
      <button v-if="hasChildren" type="button" class="toggle" :title="open ? 'Collapse' : 'Expand'" @click="open = !open">{{ open ? '−' : '+' }}</button>
      <span v-else class="toggle-space" />
      <span class="folder" aria-hidden="true">{{ hasChildren ? '🗂' : '🗀' }}</span>
      <input
        v-if="editing"
        v-model="draft"
        class="cat-input"
        autofocus
        @vue:mounted="($event.el as HTMLInputElement).focus()"
        @keydown.enter="finishRename"
        @keydown.esc="editing = false"
        @blur="finishRename"
      >
      <span v-else class="cat-name" @dblclick="startRename">{{ node.name }}</span>
      <span v-if="hasChildren" class="count">{{ node.children.length }}</span>
      <span class="actions">
        <button type="button" title="Add a category inside this one" @click="startAdd">+ Add inside</button>
        <button type="button" title="Move up" @click="move(-1)">&uarr;</button>
        <button type="button" title="Move down" @click="move(1)">&darr;</button>
        <button type="button" @click="startRename">Rename</button>
        <button type="button" @click="remove">Delete</button>
      </span>
    </div>
    <ul v-if="(hasChildren || adding) && open" class="cat-children">
      <CategoryNode v-for="child in node.children" :key="child.id" :node="child" :siblings="node.children" />
      <li v-if="adding" class="cat-node">
        <div class="cat-row">
          <span class="toggle-space" />
          <input
            v-model="draft"
            class="cat-input"
            placeholder="New category name"
            @vue:mounted="($event.el as HTMLInputElement).focus()"
            @keydown.enter="finishAdd(true)"
            @keydown.esc="adding = false"
            @blur="finishAdd(false)"
          >
        </div>
      </li>
    </ul>
  </li>
</template>

<style scoped>
.cat-node { list-style: none; position: relative; }
.cat-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0.5rem; border-radius: 0.4rem; min-height: 1.8rem; }
.cat-row:hover { background: #eef6f2; }
.toggle, .toggle-space { flex: none; width: 1.3rem; height: 1.3rem; margin: 0; }
.toggle { padding: 0; border: 1px solid #bbb; border-radius: 50%; background: #fff; color: #666; line-height: 1; cursor: pointer; }
.folder { flex: none; }
.cat-name { cursor: text; }
.count { font-size: 0.75rem; color: #666; background: #eee; border-radius: 999px; padding: 0 0.45rem; }
.cat-input { font: inherit; padding: 0.15rem 0.4rem; min-width: 16rem; }
.actions { margin-left: auto; display: none; gap: 0.25rem; }
.cat-row:hover .actions, .cat-row:focus-within .actions { display: flex; }
.actions button { margin: 0; font-size: 0.8rem; padding: 0.1rem 0.5rem; }
.cat-children { margin: 0 0 0 0.65rem; padding: 0 0 0 1.1rem; border-left: 1px solid #ccc; }
</style>
