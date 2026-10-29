<script setup lang="ts">
const { data, refresh } = await useFetch('/api/books')

// Clicking into a book remembers how far down the list was; after an update the book page sends you back here.
const SCROLL_KEY = 'dashboard-scroll'
const TOAST_KEY = 'book-toast'
function rememberScroll() {
  try {
    sessionStorage.setItem(SCROLL_KEY, String(window.scrollY))
  } catch {
    // Scroll position just won't be restored.
  }
}
// Copy an ISBN or weight to the clipboard, showing "Copied" on that button for a moment.
const copiedKey = ref<string | null>(null)
async function copyValue(key: string, text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copiedKey.value = key
    setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = null
    }, 1500)
  } catch {
    copiedKey.value = null
  }
}
// "Where I left off" is where the Updated column turns from Yes to a steady run of No: the first spot with 3 No's in a row.
// A single book skipped on the way down does not count.
const RESUME_RUN = 3
const resumeIndex = computed(() => {
  const books = data.value?.books ?? []
  return books.findIndex((_, index) => books.slice(index, index + RESUME_RUN).length === RESUME_RUN && books.slice(index, index + RESUME_RUN).every(book => !book.wasUpdated))
})
const flashRow = ref<number | null>(null)
function goToResume() {
  const index = resumeIndex.value
  if (index < 0) return
  document.getElementById(`book-row-${index}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  flashRow.value = index
  setTimeout(() => { if (flashRow.value === index) flashRow.value = null }, 2500)
}
function goToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
// Mark a book to talk to the book owner about. It turns orange; click again to clear it. Saved on this computer only.
// The fetched list is not deeply reactive, so a click is tracked here and wins over the loaded value.
const flagChanges = ref<Record<string, boolean>>({})
const isFlagged = (book: { id: string, flagged: boolean }) => flagChanges.value[book.id] ?? book.flagged
async function toggleFlag(book: { id: string, flagged: boolean }) {
  const was = isFlagged(book)
  flagChanges.value = { ...flagChanges.value, [book.id]: !was }
  try {
    await $fetch(`/api/flags/${book.id}`, { method: 'PUT', body: { flagged: !was } })
  } catch {
    flagChanges.value = { ...flagChanges.value, [book.id]: was }
  }
}
const toast = ref<{ message: string, problems: string[] } | null>(null)
onMounted(() => {
  // Coming back to the dashboard from inside the app reuses the earlier list; read it again so "Where I left off" and the Yes/No column are current.
  void refresh()
  try {
    const waiting = sessionStorage.getItem(TOAST_KEY)
    if (waiting) {
      sessionStorage.removeItem(TOAST_KEY)
      toast.value = JSON.parse(waiting)
      setTimeout(() => { toast.value = null }, 6000)
    }
    const y = Number(sessionStorage.getItem(SCROLL_KEY))
    sessionStorage.removeItem(SCROLL_KEY)
    if (y > 0) {
      // Nuxt scrolls to the top as the page appears, so this runs a moment later too.
      for (const delay of [0, 100, 300]) setTimeout(() => window.scrollTo(0, y), delay)
    }
  } catch {
    // Nothing to restore.
  }
})
</script>

<template>
  <div>
    <h1>Books</h1>
    <p v-if="!data?.hasSnapshot">
      No Square snapshot yet. Pull the catalog on the <NuxtLink to="/data">Data tools</NuxtLink> page first.
    </p>
    <template v-else>
      <p>{{ data.books.length }} books</p>
      <table class="book-table">
        <thead>
          <tr><th>#</th><th>Title</th><th>Updated in Square</th><th>Talk to owner</th><th>Shipping weight (lb)</th></tr>
        </thead>
        <tbody>
          <tr v-for="(book, index) in data.books" :id="`book-row-${index}`" :key="book.id" :class="{ flash: flashRow === index, flagged: isFlagged(book) }">
            <td class="row-number">{{ index + 1 }} / {{ data.books.length }}</td>
            <td>
              <div class="title-cell">
                <NuxtLink :to="`/books/${book.id}`" @click="rememberScroll">{{ book.title }}</NuxtLink>
                <span v-if="book.archived" class="tag">archived</span>
                <span class="isbn">{{ book.isbn }}</span>
                <button type="button" class="copy" @click="copyValue(book.isbn, book.isbn)">
                  {{ copiedKey === book.isbn ? 'Copied' : 'Copy' }}
                </button>
              </div>
            </td>
            <td>{{ book.wasUpdated ? 'Yes' : 'No' }}</td>
            <td>
              <button type="button" :class="['flag', { on: isFlagged(book) }]" :aria-pressed="isFlagged(book)" @click="toggleFlag(book)">
                {{ isFlagged(book) ? 'Needs owner' : 'Flag' }}
              </button>
            </td>
            <td>
              <div v-if="book.weight !== null" class="title-cell">
                <span>{{ book.weight }}</span>
                <button type="button" class="copy" @click="copyValue(`w:${book.id}`, String(book.weight))">
                  {{ copiedKey === `w:${book.id}` ? 'Copied' : 'Copy' }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
    <div v-for="place in ['top', 'bottom']" :key="place" :class="['jump', place]">
      <button type="button" title="Go to the first book that is not updated yet" @click="goToResume">&darr; Where I left off</button>
      <button type="button" title="Go to the top of the list" @click="goToTop">&uarr; Back to top</button>
    </div>
    <div v-if="toast" class="toast" role="status" @click="toast = null">
      <strong>{{ toast.message }}</strong>
    </div>
  </div>
</template>

<style scoped>
.row-number { color: #666; white-space: nowrap; font-variant-numeric: tabular-nums; }
.title-cell { display: flex; align-items: center; gap: 0.5rem; }
.title-cell .tag, .title-cell .isbn, .title-cell .copy { flex: none; margin: 0; }
.isbn { color: #555; font-variant-numeric: tabular-nums; margin-left: 0.5rem; }
.flag { font-size: 0.8rem; padding: 0.15rem 0.6rem; margin: 0; border: 1px solid #999; border-radius: 999px; background: #fff; color: #333; cursor: pointer; }
.flag.on { background: #f08a00; border-color: #f08a00; color: #fff; font-weight: 700; }
tr.flagged td, tr.flagged th { background: #ffe6bf; }
.copy { font-size: 0.8rem; padding: 0.1rem 0.5rem; }
.toast { position: fixed; left: 1.25rem; bottom: 1.25rem; max-width: 26rem; padding: 0.85rem 1.1rem; background: #1f7a4a; color: #fff; border-radius: 0.5rem; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25); cursor: pointer; z-index: 50; }
.jump { position: fixed; right: 1rem; z-index: 40; display: flex; gap: 0.5rem; }
.jump.top { top: 3.5rem; }
.jump.bottom { bottom: 1rem; }
.jump button { margin: 0; padding: 0.55rem 0.9rem; font-size: 0.95rem; font-weight: 600; color: #fff; background: #2f5fb3; border: 0; border-radius: 999px; cursor: pointer; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25); }
.jump button:hover { background: #244b8f; }
.flash { animation: flash-row 2.5s ease-out; }
@keyframes flash-row { 0%, 40% { background: #fff3b0; } 100% { background: transparent; } }
</style>
