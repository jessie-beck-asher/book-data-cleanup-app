<script setup lang="ts">
const { data } = await useFetch('/api/books')

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
// Remembered in a local file so it survives reloads; the box goes back if saving fails.
async function setWeightDone(book: { id: string, weightDone: boolean }, done: boolean) {
  const before = book.weightDone
  book.weightDone = done
  try {
    await $fetch(`/api/books/${book.id}/weight-done`, { method: 'PUT', body: { done } })
  } catch {
    book.weightDone = before
  }
}
// Copy an ISBN to the clipboard, showing "Copied" on that row's button for a moment.
const copiedIsbn = ref<string | null>(null)
async function copyIsbn(isbn: string) {
  try {
    await navigator.clipboard.writeText(isbn)
    copiedIsbn.value = isbn
    setTimeout(() => {
      if (copiedIsbn.value === isbn) copiedIsbn.value = null
    }, 1500)
  } catch {
    copiedIsbn.value = null
  }
}
const toast = ref<{ message: string, problems: string[] } | null>(null)
onMounted(() => {
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
          <tr><th>#</th><th>Title</th><th>Updated in Square</th><th>Shipping weight added</th></tr>
        </thead>
        <tbody>
          <tr v-for="(book, index) in data.books" :key="book.id">
            <td class="row-number">{{ index + 1 }} / {{ data.books.length }}</td>
            <td>
              <div class="title-cell">
                <NuxtLink :to="`/books/${book.id}`" @click="rememberScroll">{{ book.title }}</NuxtLink>
                <span v-if="book.archived" class="tag">archived</span>
                <span class="isbn">{{ book.isbn }}</span>
                <button type="button" class="copy" @click="copyIsbn(book.isbn)">
                  {{ copiedIsbn === book.isbn ? 'Copied' : 'Copy' }}
                </button>
              </div>
            </td>
            <td>{{ book.wasUpdated ? 'Yes' : 'No' }}</td>
            <td>
              <input
                type="checkbox"
                :checked="book.weightDone"
                :aria-label="`Shipping weight added for ${book.title}`"
                @change="setWeightDone(book, ($event.target as HTMLInputElement).checked)"
              >
            </td>
          </tr>
        </tbody>
      </table>
    </template>
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
.copy { font-size: 0.8rem; padding: 0.1rem 0.5rem; }
.toast { position: fixed; right: 1.25rem; bottom: 1.25rem; max-width: 26rem; padding: 0.85rem 1.1rem; background: #1f7a4a; color: #fff; border-radius: 0.5rem; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25); cursor: pointer; z-index: 50; }
</style>
