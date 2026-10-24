<script setup lang="ts">
import { imageNameFor, looksSprayed } from '~~/shared/imageNames'
const route = useRoute()
const { data: book, error, refresh } = await useFetch(`/api/books/${route.params.id}`)

// Edits are saved to a local file as they are made (see the autosave at the bottom of this script); nothing is sent to Square.
const saved = book.value?.saved ?? null
const proposedTitle = ref(saved?.title ?? book.value?.merged.title.title ?? '')
function resetTitle() {
  proposedTitle.value = book.value?.merged.title.title ?? ''
}

const proposedDescription = ref(saved?.description ?? book.value?.merged.description.description ?? '')
// Red outline stays until the description is edited: Square's text is cut off and ISBNdb's looks like another book.
const descriptionNeedsAttention = computed(() => {
  const merged = book.value?.merged.description
  return !!merged && merged.isbndbCheck === 'mismatch' && merged.looksCutOff && proposedDescription.value === merged.description
})
function resetDescription() {
  proposedDescription.value = book.value?.merged.description.description ?? ''
}

// Clicked pills are the categories that will be included.
const selectedCategories = ref<string[]>([...(saved?.categories ?? book.value?.merged.categories.selected ?? [])])
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

// Variation: on by default when the book's variation is not already a plain "Regular".
const changeVariation = ref(saved?.changeVariation ?? book.value?.merged.variation.needsChange ?? false)

// Images the owner has turned on. The final set is exactly what will be on the item in Square.
const defaultImageKeys = () => (book.value?.imageCandidates ?? []).filter(image => image.defaultOn).map(image => image.key)
// Saved picks are kept only for images that still exist (an upload may have been removed from disk).
const existingImageKeys = new Set((book.value?.imageCandidates ?? []).map(image => image.key))
const includedImages = ref<string[]>(saved ? saved.includedImages.filter(key => existingImageKeys.has(key)) : defaultImageKeys())
// Image names in Square: the title without the author, with dashes, then "-book-cover", plus "-sprayed-edges" on images marked here.
// An image already named with sprayed-edges starts out marked.
const sprayedEdges = ref<string[]>(saved?.sprayedEdges ?? (book.value?.imageCandidates ?? []).filter(image => looksSprayed(image.squareName)).map(image => image.key))
function toggleSprayed(key: string) {
  sprayedEdges.value = sprayedEdges.value.includes(key) ? sprayedEdges.value.filter(entry => entry !== key) : [...sprayedEdges.value, key]
}
const imageNameOf = (key: string) => imageNameFor(proposedTitle.value, sprayedEdges.value.includes(key))
const duplicateNames = computed(() => {
  const names = includedImages.value.map(imageNameOf)
  return new Set(names).size !== names.length
})

// The primary image is the one sent first to Square. Until one is chosen, it is the first included image.
const primaryImage = ref<string | null>(saved?.primaryImage ?? null)
const effectivePrimary = computed(() => {
  const included = (book.value?.imageCandidates ?? []).filter(image => includedImages.value.includes(image.key))
  return primaryImage.value && included.some(image => image.key === primaryImage.value) ? primaryImage.value : included[0]?.key ?? null
})
function toggleImage(key: string) {
  includedImages.value = includedImages.value.includes(key)
    ? includedImages.value.filter(included => included !== key)
    : [...includedImages.value, key]
}
const imagesChanged = computed(() => {
  const original = defaultImageKeys()
  return original.length !== includedImages.value.length || original.some(key => !includedImages.value.includes(key))
})
function resetImages() {
  includedImages.value = defaultImageKeys()
}
// Pixel size is read from the loaded image itself.
const imageDims = ref<Record<string, { w: number, h: number }>>({})
function recordSize(key: string, event: Event) {
  const img = event.target as HTMLImageElement
  imageDims.value[key] = { w: img.naturalWidth, h: img.naturalHeight }
}
// Images can finish loading before the page is hydrated, which misses their load event; read those sizes directly.
onMounted(() => {
  document.querySelectorAll<HTMLImageElement>('.image-card img[data-key]').forEach((img) => {
    if (img.complete && img.naturalWidth) imageDims.value[img.dataset.key!] = { w: img.naturalWidth, h: img.naturalHeight }
  })
})

// Crop: the final picture is a square frame. zoom 1 shows the whole cover inside the frame (white around it);
// larger zooms crop in. cx/cy are where the middle of the picture sits in the frame (0 to 1, 0.5 is centered).
interface Crop { zoom: number, cx: number, cy: number }
const FRAME = 360
const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
const ZOOM_STEP = 0.01
const crops = ref<Record<string, Crop>>({ ...(saved?.crops ?? {}) })
const editingKey = ref<string | null>(null)
const cropOf = (key: string): Crop => crops.value[key] ?? { zoom: 1, cx: 0.5, cy: 0.5 }
const isCropped = (key: string) => {
  const crop = cropOf(key)
  return crop.zoom !== 1 || crop.cx !== 0.5 || crop.cy !== 0.5
}
const editingImage = computed(() => book.value?.imageCandidates.find(image => image.key === editingKey.value) ?? null)

// Size and position of the picture inside the frame, in frame pixels.
function placement(key: string, crop: Crop) {
  const dims = imageDims.value[key]
  if (!dims) return null
  const scale = (FRAME / Math.max(dims.w, dims.h)) * crop.zoom
  const width = dims.w * scale
  const height = dims.h * scale
  return { width, height, left: crop.cx * FRAME - width / 2, top: crop.cy * FRAME - height / 2 }
}
// The picture may not leave blank space inside the frame once it is larger than the frame, and may not leave the frame when smaller.
function clampCenter(size: number, center: number) {
  const low = size > FRAME ? FRAME - size / 2 : size / 2
  const high = size > FRAME ? size / 2 : FRAME - size / 2
  return Math.min(Math.max(center * FRAME, low), high) / FRAME
}
function setCrop(key: string, next: Crop) {
  const dims = imageDims.value[key]
  if (!dims) return
  const zoom = Math.min(Math.max(next.zoom, MIN_ZOOM), MAX_ZOOM)
  const fit = FRAME / Math.max(dims.w, dims.h)
  crops.value[key] = {
    zoom,
    cx: clampCenter(dims.w * fit * zoom, next.cx),
    cy: clampCenter(dims.h * fit * zoom, next.cy)
  }
}
const frameStyle = computed(() => {
  const key = editingKey.value
  const place = key ? placement(key, cropOf(key)) : null
  return place ? { width: `${place.width}px`, height: `${place.height}px`, left: `${place.left}px`, top: `${place.top}px` } : { display: 'none' }
})
let dragStart: { x: number, y: number, crop: Crop } | null = null
function dragBegin(event: PointerEvent) {
  if (!editingKey.value) return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  dragStart = { x: event.clientX, y: event.clientY, crop: cropOf(editingKey.value) }
}
function dragMove(event: PointerEvent) {
  if (!dragStart || !editingKey.value) return
  setCrop(editingKey.value, {
    ...dragStart.crop,
    cx: dragStart.crop.cx + (event.clientX - dragStart.x) / FRAME,
    cy: dragStart.crop.cy + (event.clientY - dragStart.y) / FRAME
  })
}
function dragEnd() {
  dragStart = null
}
function zoomTo(zoom: number) {
  if (editingKey.value) setCrop(editingKey.value, { ...cropOf(editingKey.value), zoom })
}
function wheelZoom(event: WheelEvent) {
  if (editingKey.value) zoomTo(cropOf(editingKey.value).zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08))
}
function fitWholeCover() {
  if (editingKey.value) delete crops.value[editingKey.value]
}

// Optimize: builds the JPEG that would be sent to Square, so it can be checked first. Nothing is sent.
interface Optimized { url: string, width: number, height: number, bytes: number, quality: number, warnings: string[], cropJson: string, madeAt: number }
const optimized = ref<Record<string, Optimized>>({})
const optimizing = ref(false)
const optimizeError = ref('')
const includedCandidates = computed(() => (book.value?.imageCandidates ?? []).filter(image => includedImages.value.includes(image.key)))
// Only these get a new file made and uploaded. A Square image you have not cropped stays exactly as it is.
const willUpload = (image: { key: string, source: string }) => image.source !== 'square' || isCropped(image.key)
const uploadCandidates = computed(() => includedCandidates.value.filter(willUpload))
const isStale = (key: string) => optimized.value[key]?.cropJson !== JSON.stringify(cropOf(key))
const allOptimized = computed(() => uploadCandidates.value.length > 0 && uploadCandidates.value.every(image => optimized.value[image.key] && !isStale(image.key)))
async function optimizeIncluded() {
  if (!book.value) return
  optimizeError.value = ''
  optimizing.value = true
  try {
    for (const image of uploadCandidates.value) {
      if (optimized.value[image.key] && !isStale(image.key)) continue
      const crop = cropOf(image.key)
      const result = await $fetch<Omit<Optimized, 'cropJson' | 'madeAt'>>('/api/images/optimize', {
        method: 'POST',
        body: { isbn: book.value.isbn, key: image.key, crop }
      })
      optimized.value[image.key] = { ...result, cropJson: JSON.stringify(crop), madeAt: Date.now() }
    }
  } catch (err) {
    optimizeError.value = (err as { statusMessage?: string }).statusMessage || 'Optimize failed'
  } finally {
    optimizing.value = false
  }
}

// Optimizing runs by itself shortly after anything that affects the uploaded file changes.
let optimizeTimer: ReturnType<typeof setTimeout> | undefined
watch([uploadCandidates, crops], () => {
  clearTimeout(optimizeTimer)
  optimizeTimer = setTimeout(optimizeIncluded, 700)
}, { deep: true })
onMounted(optimizeIncluded)

// Copy a description to the clipboard, showing "Copied" on that button for a moment.
const copied = ref<string | null>(null)
async function copyText(which: string, text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = which
    setTimeout(() => {
      if (copied.value === which) copied.value = null
    }, 1500)
  } catch {
    copied.value = null
  }
}

// A green toast. After a write the page reloads so everything shows what Square now has; the toast message
// waits in sessionStorage and appears once the page is back.
const TOAST_KEY = 'book-toast'
interface Toast { message: string, problems: string[] }
const toast = ref<Toast | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined
function showToast(next: Toast) {
  toast.value = next
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = null }, next.problems.length ? 15000 : 6000)
}
function afterWrite(message: string, problems: string[]) {
  try {
    sessionStorage.setItem(TOAST_KEY, JSON.stringify({ message, problems }))
  } catch {
    // The page still reloads; it just won't show the toast.
  }
  window.location.reload()
}
onMounted(() => {
  try {
    const waiting = sessionStorage.getItem(TOAST_KEY)
    if (!waiting) return
    sessionStorage.removeItem(TOAST_KEY)
    showToast(JSON.parse(waiting))
  } catch {
    // No toast.
  }
})

// Pull just this one book from Square (a read) and reload.
const pulling = ref(false)
const pullError = ref('')
async function pullThisBook() {
  if (!book.value) return
  pullError.value = ''
  pulling.value = true
  try {
    await $fetch(`/api/books/${book.value.id}/pull`, { method: 'POST' })
    afterWrite('Pulled the latest version of this book from Square.', [])
  } catch (err) {
    pullError.value = (err as { statusMessage?: string }).statusMessage || 'Could not pull this book'
    pulling.value = false
  }
}

// Revert: sends a saved earlier copy of this item back to Square (sandbox only for now).
const reverting = ref<string | null>(null)
const revertError = ref('')
async function revertTo(name: string) {
  if (!book.value) return
  revertError.value = ''
  reverting.value = name
  try {
    const result = await $fetch<{ steps: string[], problems: string[] }>(`/api/books/${book.value.id}/revert`, { method: 'POST', body: { confirm: true, backup: name } })
    afterWrite('Yay! This book was put back to the saved version.', result.problems)
  } catch (err) {
    const error = err as { statusMessage?: string, data?: { data?: { completedSteps?: string[] } } }
    const done = error.data?.data?.completedSteps
    revertError.value = `${error.statusMessage || 'Revert failed'}${done?.length ? ` (done before it stopped: ${done.join('; ')})` : ''}`
    reverting.value = null
  }
}
const backupLabel = (backup: { savedAt: string, reason: string }) =>
  `${new Date(backup.savedAt).toLocaleString()} — ${backup.reason === 'before-revert' ? 'just before a revert' : 'just before an update'}`

// Autosave: every change is written to a local file shortly after it is made. This never touches Square.
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'failed'>(saved ? 'saved' : 'idle')
const savedAt = ref<string | null>(saved?.savedAt ?? null)
let saveTimer: ReturnType<typeof setTimeout> | undefined
async function saveEdits() {
  if (!book.value) return
  saveStatus.value = 'saving'
  try {
    const result = await $fetch<{ savedAt: string }>(`/api/books/${book.value.id}/edits`, {
      method: 'PUT',
      body: {
        title: proposedTitle.value,
        description: proposedDescription.value,
        categories: selectedCategories.value,
        changeVariation: changeVariation.value,
        includedImages: includedImages.value,
        primaryImage: primaryImage.value,
        sprayedEdges: sprayedEdges.value,
        crops: crops.value
      }
    })
    savedAt.value = result.savedAt
    saveStatus.value = 'saved'
  } catch {
    saveStatus.value = 'failed'
  }
}
watch([proposedTitle, proposedDescription, selectedCategories, changeVariation, includedImages, primaryImage, sprayedEdges, crops], () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveEdits, 600)
}, { deep: true })

// Review and update. Review only builds the diff; the update button sends this one book to Square (sandbox only for now).
interface PlanResult { environment: string, canSend: boolean, writesEnabled: boolean, blockers: string[], warnings: string[], rows: { field: string, before: string, after: string, changed: boolean }[] }
const plan = ref<PlanResult | null>(null)
const planning = ref(false)
const sending = ref(false)
const reviewError = ref('')
async function reviewChanges() {
  if (!book.value) return
  reviewError.value = ''
  planning.value = true
  try {
    clearTimeout(saveTimer)
    clearTimeout(optimizeTimer)
    await saveEdits()
    await optimizeIncluded()
    plan.value = await $fetch<PlanResult>(`/api/books/${book.value.id}/plan`, { method: 'POST' })
  } catch (err) {
    plan.value = null
    reviewError.value = (err as { statusMessage?: string }).statusMessage || 'Could not build the review'
  } finally {
    planning.value = false
  }
}
async function sendUpdate() {
  if (!book.value || !plan.value) return
  reviewError.value = ''
  sending.value = true
  try {
    const result = await $fetch<{ steps: string[], problems: string[] }>(`/api/books/${book.value.id}/send`, { method: 'POST', body: { confirm: true } })
    plan.value = null
    afterWrite('Yay! This book was updated in Square.', result.problems)
  } catch (err) {
    const error = err as { statusMessage?: string, data?: { data?: { completedSteps?: string[], blockers?: string[] } } }
    const done = error.data?.data?.completedSteps
    reviewError.value = `${error.statusMessage || 'Update failed'}${done?.length ? ` (done before it stopped: ${done.join('; ')})` : ''}`
  } finally {
    sending.value = false
  }
}

// Upload your own image; it is saved locally only.
const uploadError = ref('')
const uploading = ref(false)
async function uploadImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !book.value) return
  uploadError.value = ''
  uploading.value = true
  try {
    const body = new FormData()
    body.append('file', file)
    const { name } = await $fetch<{ name: string }>(`/api/images/uploaded/${book.value.isbn}`, { method: 'POST', body })
    await refresh()
    includedImages.value = [...includedImages.value, `upload:${name}`]
    editingKey.value = `upload:${name}`
  } catch (err) {
    uploadError.value = (err as { statusMessage?: string }).statusMessage || 'Upload failed'
  } finally {
    uploading.value = false
    input.value = ''
  }
}
function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
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
      <p>
        <button type="button" :disabled="pulling" @click="pullThisBook">{{ pulling ? 'Pulling…' : 'Pull this book from Square' }}</button>
        <span class="review-hint">Reads only this item from Square and refreshes it here. Your saved edits are kept. Nothing is changed in Square.</span>
      </p>
      <p v-if="pullError" class="warning">{{ pullError }}</p>

      <p v-if="book.isbndb.status === 'not_fetched'" class="note">ISBNdb data has not been fetched for this book yet.</p>
      <p v-else-if="book.isbndb.status === 'no_match'" class="note">ISBNdb has no match for this ISBN.</p>

      <section class="proposed">
        <h2>
          Proposed values for Square
          <small>
            Your edits are saved on this computer as you go. Nothing is sent to Square.
            <span v-if="saveStatus === 'saving'">Saving…</span>
            <span v-else-if="saveStatus === 'saved' && savedAt" class="saved">Saved {{ new Date(savedAt).toLocaleTimeString() }}</span>
            <span v-else-if="saveStatus === 'failed'" class="warning">Could not save.</span>
          </small>
        </h2>

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

          <div class="field-label">
            <strong>Variation</strong>
          </div>
          <div class="variation">
            <template v-if="book.merged.variation.handled">
              <p>
                <span class="was">{{ book.merged.variation.currentName || '(no name)' }}</span>
                <template v-if="book.merged.variation.needsChange"> → <strong>{{ book.merged.variation.proposedName }}</strong></template>
              </p>
              <button
                v-if="book.merged.variation.needsChange"
                type="button"
                :class="['pill', { on: changeVariation }]"
                :aria-pressed="changeVariation"
                @click="changeVariation = !changeVariation"
              >
                Change to Regular
              </button>
            </template>
          </div>
          <div class="reasons">
            <ul>
              <li v-for="note in book.merged.variation.notes" :key="note">{{ note }}</li>
            </ul>
            <details v-if="book.merged.variation.preserved.length">
              <summary>Stays exactly as it is in Square</summary>
              <ul>
                <li v-for="line in book.merged.variation.preserved" :key="line">{{ line }}</li>
              </ul>
            </details>
          </div>

          <div class="field-label">
            <strong>Images</strong>
            <button :disabled="!imagesChanged" @click="resetImages">Reset</button>
          </div>
          <div class="image-cards">
            <p v-if="!book.imageCandidates.length">No images yet.</p>
            <div
              v-for="image in book.imageCandidates"
              :key="image.key"
              :class="['image-card', { off: !includedImages.includes(image.key) }]"
            >
              <img :src="image.url" :data-key="image.key" alt="" @load="recordSize(image.key, $event)">
              <div class="image-meta">
                <strong>{{ image.label }}</strong>
                <span>
                  {{ imageDims[image.key] ? `${imageDims[image.key]!.w}×${imageDims[image.key]!.h}` : '…' }}<template v-if="image.bytes"> · {{ formatBytes(image.bytes) }}</template>
                </span>
                <span v-if="isCropped(image.key)" class="cropped">Cropped</span>
              </div>
              <button type="button" @click="editingKey = editingKey === image.key ? null : image.key">
                {{ editingKey === image.key ? 'Close editor' : 'Crop / fit' }}
              </button>
              <button
                type="button"
                :class="['pill', { on: includedImages.includes(image.key) }]"
                :aria-pressed="includedImages.includes(image.key)"
                @click="toggleImage(image.key)"
              >
                {{ includedImages.includes(image.key) ? 'Included' : 'Not included' }}
              </button>
              <template v-if="includedImages.includes(image.key)">
                <span class="image-name">Name in Square: <code>{{ imageNameOf(image.key) }}</code></span>
                <button
                  type="button"
                  :class="['pill', { on: sprayedEdges.includes(image.key) }]"
                  :aria-pressed="sprayedEdges.includes(image.key)"
                  @click="toggleSprayed(image.key)"
                >
                  Sprayed edges
                </button>
              </template>
              <span v-if="includedImages.includes(image.key) && effectivePrimary === image.key" class="primary-badge">★ Primary (sent first)</span>
              <button v-else-if="includedImages.includes(image.key)" type="button" @click="primaryImage = image.key">Make primary</button>
              <p v-if="image.source === 'square' && !includedImages.includes(image.key)" class="warning">
                Will be deleted from Square.
              </p>
            </div>
            <div class="image-add">
              <label class="upload-label">
                Add your own image
                <input type="file" accept="image/jpeg,image/png,image/webp" :disabled="uploading" @change="uploadImage">
              </label>
              <p v-if="uploadError" class="warning">{{ uploadError }}</p>
            </div>
          </div>
          <div class="reasons">
            <div class="optimize">
              <strong>Files that will be uploaded</strong>
              <span v-if="optimizing" class="review-hint">Making previews…</span>
              <span v-else-if="allOptimized" class="ok">These are the exact files that would be uploaded.</span>
              <p v-if="includedCandidates.length && !uploadCandidates.length" class="review-hint">No new file is needed: the included images are already in Square and are kept as they are.</p>
              <p v-if="optimizeError" class="warning">{{ optimizeError }}</p>
              <div v-for="image in uploadCandidates.filter(candidate => optimized[candidate.key])" :key="image.key" class="optimized-item">
                <img :src="`${optimized[image.key]!.url}?t=${optimized[image.key]!.madeAt}`" alt="">
                <div>
                  <strong>{{ image.label }}</strong>
                  <div>{{ optimized[image.key]!.width }}×{{ optimized[image.key]!.height }} · {{ formatBytes(optimized[image.key]!.bytes) }} · JPEG quality {{ optimized[image.key]!.quality }}</div>
                  <div v-if="isStale(image.key)" class="stale">Out of date: the crop changed. Updating the preview…</div>
                  <div v-for="warning in optimized[image.key]!.warnings" :key="warning" class="warning">{{ warning }}</div>
                </div>
              </div>
            </div>
            <div v-if="editingImage" class="cropper">
              <p><strong>Cropping: {{ editingImage.label }}</strong></p>
              <div
                class="crop-frame"
                :style="{ width: `${FRAME}px`, height: `${FRAME}px` }"
                @pointerdown="dragBegin"
                @pointermove="dragMove"
                @pointerup="dragEnd"
                @pointercancel="dragEnd"
                @wheel.prevent="wheelZoom"
              >
                <img :src="editingImage.url" alt="" draggable="false" :style="frameStyle">
              </div>
              <label class="zoom">
                Zoom
                <button type="button" aria-label="Zoom out a little" :disabled="cropOf(editingImage.key).zoom <= MIN_ZOOM" @click="zoomTo(cropOf(editingImage.key).zoom - ZOOM_STEP)">−</button>
                <input
                  type="range"
                  :min="MIN_ZOOM"
                  :max="MAX_ZOOM"
                  step="0.01"
                  :value="cropOf(editingImage.key).zoom"
                  @input="zoomTo(Number(($event.target as HTMLInputElement).value))"
                >
                <button type="button" aria-label="Zoom in a little" :disabled="cropOf(editingImage.key).zoom >= MAX_ZOOM" @click="zoomTo(cropOf(editingImage.key).zoom + ZOOM_STEP)">+</button>
              </label>
              <p>
                <button type="button" :disabled="!isCropped(editingImage.key)" @click="fitWholeCover">Fit whole cover</button>
                <button type="button" @click="editingKey = null">Done</button>
              </p>
              <p>Drag to move, scroll or use the slider to zoom. Zoom out past the middle to shrink the cover and add white around it. White shows where the cover does not fill the frame. Nothing is saved yet.</p>
            </div>
            <p v-if="duplicateNames" class="warning">Two included images would get the same name. Mark one of them as Sprayed edges.</p>
            <p v-if="!includedImages.length" class="warning">No images are included, so the item would have none.</p>
            <ul>
              <li v-if="book.imageCandidates.some(image => image.source === 'square')">Existing Square images stay unless you turn them off.</li>
              <li v-if="book.imageCandidates.some(image => image.source === 'isbndb')">
                The ISBNdb cover is only on by default when the item has no image yet.
              </li>
              <li v-else>No ISBNdb cover has been saved for this book.</li>
            </ul>
          </div>
        </div>

        <div class="review">
          <button type="button" :disabled="planning || sending" @click="reviewChanges">
            {{ planning ? 'Building review…' : 'Review changes' }}
          </button>
          <span class="review-hint">Shows exactly what would change. Nothing is sent until you press the update button.</span>
          <p v-if="reviewError" class="warning">{{ reviewError }}</p>

          <div v-if="plan" class="plan">
            <table class="plan-table">
              <thead><tr><th>Field</th><th>Now in Square</th><th>After the update</th></tr></thead>
              <tbody>
                <tr v-for="row in plan.rows" :key="row.field" :class="{ changed: row.changed }">
                  <th>{{ row.field }}<span v-if="row.changed" class="tag">changes</span><span v-else class="tag same">unchanged</span></th>
                  <td class="text">{{ row.before }}</td>
                  <td class="text">{{ row.after }}</td>
                </tr>
              </tbody>
            </table>
            <ul v-if="plan.blockers.length" class="blockers">
              <li v-for="blocker in plan.blockers" :key="blocker" class="warning">Blocked: {{ blocker }}</li>
            </ul>
            <ul v-if="plan.warnings.length">
              <li v-for="warning in plan.warnings" :key="warning" class="incomplete-note">{{ warning }}</li>
            </ul>
            <p v-if="!plan.writesEnabled" class="warning">Writing to production is off for this book, so the update button is off.</p>
            <button type="button" class="send" :disabled="!plan.canSend || sending" @click="sendUpdate">
              {{ sending ? 'Updating…' : `Looks good, update this book in Square (${plan.environment})` }}
            </button>
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
            <td class="text">
              <button v-if="book.square.description" type="button" class="copy" @click="copyText('square', book.square.description)">
                {{ copied === 'square' ? 'Copied' : 'Copy' }}
              </button>
              <div>{{ book.square.description || '(none)' }}</div>
            </td>
            <td class="text">
              <button v-if="book.isbndb.status === 'found' && book.isbndb.description" type="button" class="copy" @click="copyText('isbndb', book.isbndb.description)">
                {{ copied === 'isbndb' ? 'Copied' : 'Copy' }}
              </button>
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

      <h2>Raw Square JSON</h2>
      <pre class="raw">{{ JSON.stringify(book.squareRaw, null, 2) }}</pre>

      <h2>Original Square JSON (before changes from this app)</h2>
      <p v-if="!book.backups.length">Nothing yet. A copy is saved here automatically right before each update.</p>
      <p v-if="revertError" class="warning">{{ revertError }}</p>
      <details v-for="(backup, index) in book.backups" :key="backup.name" class="backup" :open="index === 0">
        <summary>{{ backupLabel(backup) }} (version {{ backup.itemVersion }})</summary>
        <p>
          <button type="button" class="revert" :disabled="!!reverting" @click="revertTo(backup.name)">
            {{ reverting === backup.name ? 'Reverting…' : 'Revert to this previous version' }}
          </button>
          <span class="review-hint">The current version is saved here first, so you can undo a revert.</span>
        </p>
        <pre class="raw">{{ JSON.stringify(backup.item, null, 2) }}</pre>
      </details>
    </template>

    <div v-if="toast" class="toast" role="status" @click="toast = null">
      <strong>{{ toast.message }}</strong>
      <ul v-if="toast.problems.length">
        <li v-for="problem in toast.problems" :key="problem">{{ problem }}</li>
      </ul>
    </div>
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

.copy { display: block; margin-bottom: 0.35rem; }
.review { margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid #ddd; }
.review-hint { margin-left: 0.75rem; font-size: 0.8rem; color: #555; }
.plan { margin-top: 0.75rem; }
.plan-table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
.plan-table th, .plan-table td { text-align: left; vertical-align: top; padding: 0.4rem 0.75rem 0.4rem 0; border-top: 1px solid #ddd; }
.plan-table th { width: 12rem; }
.plan-table .text { white-space: pre-wrap; word-break: break-word; }
.plan-table tr.changed { background: #eef6ff; }
.plan-table .tag.same { background: #eee; color: #555; }
.send { margin-top: 0.75rem; font-weight: 600; padding: 0.5rem 1rem; }
.toast { position: fixed; right: 1.25rem; bottom: 1.25rem; max-width: 26rem; padding: 0.85rem 1.1rem; background: #1f7a4a; color: #fff; border-radius: 0.5rem; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25); cursor: pointer; z-index: 50; }
.toast ul { margin: 0.4rem 0 0; padding-left: 1.2rem; font-size: 0.9rem; }
.backup { margin: 0.5rem 0; }
.backup summary { cursor: pointer; font-weight: 600; }
.revert { font-weight: 600; }
.blockers { padding-left: 1rem; }
.proposed h2 .saved { color: #1f6f43; font-weight: 600; margin-left: 0.5rem; }
.variation p { margin: 0 0 0.35rem; }
.variation .was { color: #555; }
.pills { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.pill { font: inherit; font-size: 0.9rem; padding: 0.25rem 0.8rem; border: 1px solid #999; border-radius: 999px; background: #fff; color: #333; cursor: pointer; }
.pill.on { background: #1f6f43; border-color: #1f6f43; color: #fff; }
.pill.on.suggested { background: #2f5fb3; border-color: #2f5fb3; }

.image-cards { display: flex; flex-wrap: wrap; gap: 1rem; }
.image-card { display: flex; flex-direction: column; gap: 0.35rem; align-items: flex-start; max-width: 11rem; }
.image-card img { height: 12rem; max-width: 100%; object-fit: contain; border: 1px solid #ddd; background: #fff; }
.image-card.off img { opacity: 0.4; }
.image-meta { display: flex; flex-direction: column; font-size: 0.8rem; color: #555; }
.image-card .warning { font-size: 0.8rem; margin: 0; }

.image-card .image-name { font-size: 0.8rem; color: #444; word-break: break-all; }
.image-card .primary-badge { font-size: 0.85rem; font-weight: 600; color: #8a5a00; background: #fff3cd; border: 1px solid #e0b84a; border-radius: 999px; padding: 0.2rem 0.7rem; }
.image-card .cropped { color: #2f5fb3; font-weight: 600; }
.image-add { align-self: center; }
.upload-label { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.85rem; }
.optimize { margin-bottom: 0.75rem; }
.optimize .ok { margin-left: 0.5rem; color: #1f6f43; font-weight: 600; }
.optimized-item { display: flex; gap: 0.75rem; margin-top: 0.5rem; align-items: flex-start; }
.optimized-item img { width: 6rem; height: 6rem; object-fit: contain; border: 1px solid #ddd; background: #fff; }
.optimized-item .warning { font-weight: 400; margin-top: 0.15rem; }
.optimized-item .stale { color: #8a6500; font-weight: 600; }
.cropper { margin-bottom: 0.75rem; }
.crop-frame { position: relative; overflow: hidden; background: #fff; border: 2px solid #333; cursor: grab; touch-action: none; user-select: none; }
.crop-frame img { position: absolute; max-width: none; pointer-events: none; }
.zoom { display: flex; align-items: center; gap: 0.5rem; margin: 0.5rem 0; }

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
