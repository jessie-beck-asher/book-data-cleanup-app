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
          <tr><th>Title</th><th>Updated in Square</th></tr>
        </thead>
        <tbody>
          <tr v-for="book in data.books" :key="book.id">
            <td>
              <NuxtLink :to="`/books/${book.id}`" @click="rememberScroll">{{ book.title }}</NuxtLink>
              <span v-if="book.archived" class="tag">archived</span>
            </td>
            <td>{{ book.wasUpdated ? 'Yes' : 'No' }}</td>
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
.toast { position: fixed; right: 1.25rem; bottom: 1.25rem; max-width: 26rem; padding: 0.85rem 1.1rem; background: #1f7a4a; color: #fff; border-radius: 0.5rem; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25); cursor: pointer; z-index: 50; }
</style>
