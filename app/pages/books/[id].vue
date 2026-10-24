<script setup lang="ts">
const route = useRoute()
const { data: book, error } = await useFetch(`/api/books/${route.params.id}`)

// Edits live only on this page for now; they are not saved anywhere yet.
const proposedTitle = ref(book.value?.merged.title.title ?? '')
function resetTitle() {
  proposedTitle.value = book.value?.merged.title.title ?? ''
}

const proposedDescription = ref(book.value?.merged.description.description ?? '')
// Red outline stays until the description is edited: Square's text is cut off and ISBNdb's looks like another book.
const descriptionNeedsAttention = computed(() => {
  const merged = book.value?.merged.description
  return !!merged && merged.isbndbCheck === 'mismatch' && merged.looksCutOff && proposedDescription.value === merged.description
})
function resetDescription() {
  proposedDescription.value = book.value?.merged.description.description ?? ''
}

// Clicked pills are the categories that will be included.
const selectedCategories = ref<string[]>([...(book.value?.merged.categories.selected ?? [])])
function toggleCategory(name: string) {
  selectedCategories.value = selectedCategories.value.includes(name)
    ? selectedCategories.value.filter(category => category !== name)
    : [...selectedCategories.value, name]
}
const categoriesChanged = computed(() => {
  const original = book.value?.merged.categories.selected ?? []
  return original.length !== selectedCategories.value.length || original.some(name => !selectedCategories.value.includes(name))
})
function resetCategories() {
  selectedCategories.value = [...(book.value?.merged.categories.selected ?? [])]
}
</script>

<template>
  <div class="book-page">
    <p class="back"><NuxtLink to="/">← Back to books</NuxtLink></p>
    <p v-if="error" class="error">{{ error.statusMessage || 'Could not load this book' }}</p>

    <template v-else-if="book">
      <h1 class="book-head">
        {{ book.square.title || '(untitled)' }}
        <span v-if="book.archived" class="tag">archived</span>
        <small>ISBN {{ book.isbn }}</small>
      </h1>

      <p v-if="book.isbndb.status === 'not_fetched'" class="note">ISBNdb data has not been fetched for this book yet.</p>
      <p v-else-if="book.isbndb.status === 'no_match'" class="note">ISBNdb has no match for this ISBN.</p>

      <section class="proposed">
        <h2>Proposed values for Square <small>Edits are not saved yet, and nothing is sent to Square.</small></h2>

        <div class="proposed-grid">
          <div class="field-label">
            <label for="proposed-title"><strong>Title</strong></label>
            <button :disabled="proposedTitle === book.merged.title.title" @click="resetTitle">Reset</button>
          </div>
          <input id="proposed-title" v-model="proposedTitle" type="text" class="field-input">
          <div class="reasons">
            <p v-if="proposedTitle === book.square.title">Same as the current Square title.</p>
            <ul>
              <li v-for="note in book.merged.title.notes" :key="note">{{ note }}</li>
            </ul>
          </div>

          <div class="field-label">
            <label for="proposed-description"><strong>Description</strong></label>
            <button :disabled="proposedDescription === book.merged.description.description" @click="resetDescription">Reset</button>
          </div>
          <textarea
            id="proposed-description"
            v-model="proposedDescription"
            rows="10"
            :class="['field-input', { incomplete: descriptionNeedsAttention }]"
          />
          <div class="reasons">
            <p v-if="book.merged.description.isbndbCheck === 'mismatch'" class="warning">
              The ISBNdb description may be for a different book (outlined in red below).
            </p>
            <p v-if="descriptionNeedsAttention" class="incomplete-note">
              Outlined in yellow: the Square text looks cut off and ISBNdb's does not match. Edit it to clear the outline.
            </p>
            <ul>
              <li v-for="note in book.merged.description.notes" :key="note">{{ note }}</li>
            </ul>
          </div>

          <div class="field-label">
            <strong>Categories</strong>
            <button :disabled="!categoriesChanged" @click="resetCategories">Reset</button>
          </div>
          <div class="pills">
            <button
              v-for="name in book.categoryChoices"
              :key="name"
              type="button"
              :class="['pill', { on: selectedCategories.includes(name), suggested: book.merged.categories.suggested.includes(name) }]"
              :aria-pressed="selectedCategories.includes(name)"
              @click="toggleCategory(name)"
            >
              {{ name }}
            </button>
          </div>
          <div class="reasons">
            <p v-if="!selectedCategories.includes('Books')" class="warning">"Books" is not included.</p>
            <ul>
              <li v-for="note in book.merged.categories.notes" :key="note">{{ note }}</li>
            </ul>
          </div>
        </div>
      </section>

      <table class="compare">
        <thead>
          <tr><th /><th>Square (current)</th><th>ISBNdb (reference)</th></tr>
        </thead>
        <tbody>
          <tr>
            <th>Title</th>
            <td>{{ book.square.title }}</td>
            <td>{{ book.isbndb.status === 'found' ? book.isbndb.title : '—' }}</td>
          </tr>
          <tr>
            <th>Description</th>
            <td class="text">{{ book.square.description || '(none)' }}</td>
            <td class="text">
              <div :class="{ flagged: book.merged.description.isbndbCheck === 'mismatch' }">
                {{ book.isbndb.status === 'found' ? book.isbndb.description || '(none)' : '—' }}
              </div>
            </td>
          </tr>
          <tr>
            <th>Categories</th>
            <td>{{ book.square.categories.length ? book.square.categories.join(', ') : '(none)' }}</td>
            <td>
              <template v-if="book.isbndb.status === 'found'">
                {{ book.isbndb.subjects.length ? book.isbndb.subjects.join(', ') : '(no subjects)' }}
                <span class="tag">subjects, reference only</span>
              </template>
              <template v-else>—</template>
            </td>
          </tr>
          <tr>
            <th>Images</th>
            <td>
              <img v-for="url in book.square.images" :key="url" :src="url" alt="" class="cover">
              <template v-if="!book.square.images.length">(none)</template>
            </td>
            <td>
              <template v-if="book.isbndb.status === 'found'">
                <img v-if="book.isbndb.image" :src="book.isbndb.image" alt="" class="cover">
                <template v-else>(none)</template>
              </template>
              <template v-else>—</template>
            </td>
          </tr>
          <tr>
            <th>Shipping weight</th>
            <td>Not available through Square's API</td>
            <td>
              <template v-if="book.isbndb.status === 'found'">
                {{ book.isbndb.dimensions ? JSON.stringify(book.isbndb.dimensions) : 'Not provided by ISBNdb' }}
              </template>
              <template v-else>—</template>
            </td>
          </tr>
        </tbody>
      </table>

      <template v-if="book.isbndb.status === 'found'">
        <h2>More from ISBNdb</h2>
        <ul>
          <li>Authors: {{ book.isbndb.authors.join('; ') || '—' }}</li>
          <li>Publisher: {{ book.isbndb.publisher ?? '—' }}</li>
          <li>Published: {{ book.isbndb.datePublished ?? '—' }}</li>
          <li>Pages: {{ book.isbndb.pages ?? '—' }}</li>
          <li>Binding: {{ book.isbndb.binding ?? '—' }}</li>
        </ul>
      </template>

      <h2>Raw ISBNdb JSON</h2>
      <pre v-if="book.isbndbRaw" class="raw">{{ JSON.stringify(book.isbndbRaw, null, 2) }}</pre>
      <p v-else>Nothing saved from ISBNdb for this book yet.</p>
    </template>
  </div>
</template>

<style>
.book-page { max-width: 100rem; }
.book-page .back { margin: 0 0 0.25rem; }
.book-head { font-size: 1.3rem; margin: 0.25rem 0 0.5rem; }
.book-head small { font-size: 0.85rem; font-weight: normal; color: #555; margin-left: 0.75rem; }

.proposed { padding: 0.5rem 1rem 0.75rem; border: 1px solid #ddd; background: #fafafa; margin-bottom: 1rem; }
.proposed h2 { font-size: 1.05rem; margin: 0 0 0.5rem; }
.proposed h2 small { font-size: 0.8rem; font-weight: normal; color: #555; margin-left: 0.75rem; }
.proposed-grid { display: grid; grid-template-columns: 6rem minmax(0, 1fr) minmax(16rem, 28rem); gap: 1rem 2rem; align-items: start; }
.proposed-grid > :nth-child(-n+3) { padding-bottom: 10px; }
.field-label { display: flex; flex-direction: column; align-items: flex-start; gap: 0.25rem; }
.field-input { width: 100%; font: inherit; font-size: 0.95rem; padding: 0.35rem; box-sizing: border-box; }
.reasons { font-size: 0.8rem; color: #555; }
.reasons p { margin: 0 0 0.25rem; }
.reasons ul { margin: 0; padding-left: 1rem; }

.pills { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.pill { font: inherit; font-size: 0.9rem; padding: 0.25rem 0.8rem; border: 1px solid #999; border-radius: 999px; background: #fff; color: #333; cursor: pointer; }
.pill.on { background: #1f6f43; border-color: #1f6f43; color: #fff; }
.pill.on.suggested { background: #2f5fb3; border-color: #2f5fb3; }

.compare { border-collapse: collapse; width: 100%; }
.compare th, .compare td { text-align: left; vertical-align: top; padding: 0.4rem 1rem 0.4rem 0; border-top: 1px solid #ddd; }
.compare thead th { border-top: none; }
.compare tbody th { width: 9rem; }
.compare .text { white-space: pre-wrap; }
.cover { max-height: 12rem; margin-right: 0.5rem; }
.note { font-size: 0.85rem; color: #555; }
.warning { color: #b00020; font-weight: 600; }
.flagged { outline: 3px solid #d00; outline-offset: 2px; padding: 0.25rem; }
.incomplete { outline: 3px solid #f2b705; outline-offset: 2px; }
.incomplete-note { color: #8a6500; font-weight: 600; }
</style>
