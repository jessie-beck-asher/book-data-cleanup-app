<script setup lang="ts">
import { slugify } from '~~/shared/imageNames'

// Images of one bookish item: the size of each, alerts for pictures that are too small, a crop/move/zoom editor,
// and the optimized JPEG that would be sent to Square. Nothing here is saved or sent anywhere.
const props = defineProps<{
  itemId: string
  title: string
  description: string
  altDrafts: Record<string, string>
  images: { id: string, url: string, variations: string[], variationNames: string[], isUpload?: boolean }[]
}>()

// Same limits as the optimizer: longest side 1200 to 2000 px, file size 150 to 500 KB.
const MIN_SIDE = 1200
const VERY_SMALL_SIDE = 600

interface Crop { zoom: number, cx: number, cy: number }
const FRAME = 360
const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
const ZOOM_STEP = 0.01

const dims = ref<Record<string, { w: number, h: number }>>({})
function recordSize(id: string, event: Event) {
  const img = event.target as HTMLImageElement
  dims.value[id] = { w: img.naturalWidth, h: img.naturalHeight }
}
// Images can finish loading before the page is hydrated, which misses their load event; read those sizes directly.
onMounted(() => {
  document.querySelectorAll<HTMLImageElement>('.bookish-images img[data-id]').forEach((img) => {
    if (img.complete && img.naturalWidth) dims.value[img.dataset.id!] = { w: img.naturalWidth, h: img.naturalHeight }
  })
})

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

// The alert for a picture whose own pixels are too few. Looks at the original, not the crop.
function sizeAlert(id: string) {
  const d = dims.value[id]
  if (!d) return null
  const longest = Math.max(d.w, d.h)
  if (longest < VERY_SMALL_SIDE) return { level: 'bad', text: `Very small: ${d.w}×${d.h} px. It will look blurry at the ${MIN_SIDE} px minimum. Replace it with a bigger picture.` }
  if (longest < MIN_SIDE) return { level: 'warn', text: `Too small: ${d.w}×${d.h} px, under the ${MIN_SIDE} px minimum on the long side. It would be enlarged and look soft.` }
  return null
}

// Crop: the final picture is a square frame. zoom 1 shows the whole picture inside the frame (white around it);
// larger zooms crop in. cx/cy are where the middle of the picture sits in the frame (0 to 1, 0.5 is centered).
const crops = ref<Record<string, Crop>>({})
const editingId = ref<string | null>(null)
// Images marked for removal are not sent back to Square and are deleted from it.
const removedIds = ref<string[]>([])
const isRemoved = (id: string) => removedIds.value.includes(id)
const keptImages = computed(() => props.images.filter(image => !isRemoved(image.id)))
function toggleRemoved(id: string) {
  if (isRemoved(id)) {
    removedIds.value = removedIds.value.filter(other => other !== id)
    return
  }
  removedIds.value = [...removedIds.value, id]
  if (editingId.value === id) editingId.value = null
  if (pickedPrimary.value === id) pickedPrimary.value = null
}
// The first image is the primary one unless another is picked (Square sends the primary first).
const pickedPrimary = ref<string | null>(null)
const primaryId = computed(() => keptImages.value.some(image => image.id === pickedPrimary.value) ? pickedPrimary.value : keptImages.value[0]?.id ?? null)
const cropOf = (id: string): Crop => crops.value[id] ?? { zoom: 1, cx: 0.5, cy: 0.5 }
const isCropped = (id: string) => {
  const crop = cropOf(id)
  return crop.zoom !== 1 || crop.cx !== 0.5 || crop.cy !== 0.5
}
const editingImage = computed(() => props.images.find(image => image.id === editingId.value) ?? null)

function placement(id: string, crop: Crop) {
  const d = dims.value[id]
  if (!d) return null
  const scale = (FRAME / Math.max(d.w, d.h)) * crop.zoom
  const width = d.w * scale
  const height = d.h * scale
  return { width, height, left: crop.cx * FRAME - width / 2, top: crop.cy * FRAME - height / 2 }
}
function clampCenter(size: number, center: number) {
  const low = size > FRAME ? FRAME - size / 2 : size / 2
  const high = size > FRAME ? size / 2 : FRAME - size / 2
  return Math.min(Math.max(center * FRAME, low), high) / FRAME
}
function setCrop(id: string, next: Crop) {
  const d = dims.value[id]
  if (!d) return
  const zoom = Math.min(Math.max(next.zoom, MIN_ZOOM), MAX_ZOOM)
  const fit = FRAME / Math.max(d.w, d.h)
  crops.value[id] = { zoom, cx: clampCenter(d.w * fit * zoom, next.cx), cy: clampCenter(d.h * fit * zoom, next.cy) }
}
const frameStyle = computed(() => {
  const id = editingId.value
  const place = id ? placement(id, cropOf(id)) : null
  return place ? { width: `${place.width}px`, height: `${place.height}px`, left: `${place.left}px`, top: `${place.top}px` } : { display: 'none' }
})
let dragStart: { x: number, y: number, crop: Crop } | null = null
function dragBegin(event: PointerEvent) {
  if (!editingId.value) return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  dragStart = { x: event.clientX, y: event.clientY, crop: cropOf(editingId.value) }
}
function dragMove(event: PointerEvent) {
  if (!dragStart || !editingId.value) return
  setCrop(editingId.value, {
    ...dragStart.crop,
    cx: dragStart.crop.cx + (event.clientX - dragStart.x) / FRAME,
    cy: dragStart.crop.cy + (event.clientY - dragStart.y) / FRAME
  })
}
function dragEnd() {
  dragStart = null
}
function zoomTo(zoom: number) {
  if (editingId.value) setCrop(editingId.value, { ...cropOf(editingId.value), zoom })
}
function wheelZoom(event: WheelEvent) {
  if (editingId.value) zoomTo(cropOf(editingId.value).zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08))
}
function fitWhole() {
  if (editingId.value) delete crops.value[editingId.value]
}

// Optimize: builds the JPEG that would be sent to Square, so it can be checked first.
interface Optimized { dataUrl: string, width: number, height: number, bytes: number, quality: number, warnings: string[], sourceBytes: number, sourceFormat: string, cropJson: string }
const optimized = ref<Record<string, Optimized>>({})
const optimizing = ref(false)
const optimizeError = ref('')
const isStale = (id: string) => optimized.value[id]?.cropJson !== JSON.stringify(cropOf(id))
async function optimizeAll() {
  if (optimizing.value) return
  optimizeError.value = ''
  optimizing.value = true
  try {
    for (const image of keptImages.value) {
      if (optimized.value[image.id] && !isStale(image.id)) continue
      const crop = cropOf(image.id)
      const result = await $fetch<Omit<Optimized, 'cropJson'>>(`/api/bookish/${props.itemId}/optimize`, { method: 'POST', body: { imageId: image.id, crop } })
      optimized.value[image.id] = { ...result, cropJson: JSON.stringify(crop) }
    }
  } catch (err) {
    optimizeError.value = (err as { data?: { statusMessage?: string } }).data?.statusMessage || 'Optimize failed'
  } finally {
    optimizing.value = false
  }
  // A crop that changed while this ran is picked up now.
  if (keptImages.value.some(image => optimized.value[image.id] && isStale(image.id))) void optimizeAll()
}
let optimizeTimer: ReturnType<typeof setTimeout> | undefined
watch(crops, () => {
  clearTimeout(optimizeTimer)
  optimizeTimer = setTimeout(optimizeAll, 600)
}, { deep: true })
onMounted(optimizeAll)
onBeforeUnmount(() => clearTimeout(optimizeTimer))

// Names the images get in Square. The primary image is named for the item, an image tied to a variation is the item plus that
// variation, and every other image is the item plus "details" and a number that counts up. The owner can type over any of them.
const nameOverrides = ref<Record<string, string>>({})
const baseName = computed(() => slugify(props.title) || 'item')
const defaultNames = computed(() => {
  const names: Record<string, string> = {}
  const taken = new Set<string>()
  const claim = (wanted: string) => {
    let name = wanted
    for (let n = 2; taken.has(name); n++) name = `${wanted}-${n}`
    taken.add(name)
    return name
  }
  if (primaryId.value) names[primaryId.value] = claim(baseName.value)
  for (const image of keptImages.value) {
    if (names[image.id]) continue
    const variation = image.variationNames.map(slugify).find(slug => slug && slug !== 'regular')
    if (variation) names[image.id] = claim(`${baseName.value}-${variation}`)
  }
  let n = 1
  for (const image of keptImages.value) {
    if (names[image.id]) continue
    names[image.id] = claim(`${baseName.value}-details-${n++}`)
  }
  return names
})
const nameOf = (id: string) => nameOverrides.value[id] || defaultNames.value[id] || ''
function setName(id: string, text: string) {
  const clean = slugify(text)
  if (clean && clean !== defaultNames.value[id]) nameOverrides.value[id] = clean
  else delete nameOverrides.value[id]
}
const duplicateNames = computed(() => {
  const names = keptImages.value.map(image => nameOf(image.id))
  return new Set(names).size !== names.length
})

const editingOptimized = computed(() => (editingId.value ? optimized.value[editingId.value] : null) ?? null)
// Alt text (Square's image caption), typed by you or written by the AI. An image with none keeps the old behaviour: its name with spaces.
const altOverrides = ref<Record<string, string>>({ ...props.altDrafts })
const altOf = (id: string) => altOverrides.value[id] ?? ''
function setAlt(id: string, text: string) {
  if (text.trim()) altOverrides.value[id] = text.trim()
  else delete altOverrides.value[id]
}

// Write alt text with AI: sends ONLY the pictures that will go to Square (not the ones marked for removal), only when the button is pressed.
const writing = ref(false)
const writeError = ref('')
const writeNote = ref('')
const writeProgress = ref('')
async function writeAltText() {
  const sending = keptImages.value
  if (!sending.length || writing.value) return
  const message = `Send ${sending.length} picture${sending.length === 1 ? '' : 's'} to OpenAI to write alt text?\n\n`
    + `Only the pictures that will be sent to Square are included${removedIds.value.length ? ` (${removedIds.value.length} marked for removal ${removedIds.value.length === 1 ? 'is' : 'are'} left out)` : ''}.\n`
    + 'This uses your OpenAI credits. Text you typed in an alt text box will be replaced.'
  if (!window.confirm(message)) return
  writing.value = true
  writeError.value = ''
  writeNote.value = ''
  // One picture per request, so each alt text appears as soon as it is written and the button shows how far along it is.
  const problems: string[] = []
  let written = 0
  try {
    for (const [index, image] of sending.entries()) {
      writeProgress.value = `${index + 1} of ${sending.length}`
      try {
        const result = await $fetch<{ results: { id: string, alt: string }[], errors: { id: string, error: string }[] }>(`/api/bookish/${props.itemId}/alt-text`, {
          method: 'POST',
          timeout: 180_000,
          body: { images: [{ id: image.id, crop: cropOf(image.id) }] }
        })
        for (const { id, alt } of result.results) {
          altOverrides.value[id] = alt
          written++
        }
        for (const { error } of result.errors) problems.push(error)
      } catch (err) {
        problems.push((err as { data?: { statusMessage?: string } }).data?.statusMessage || 'Could not write alt text')
      }
    }
  } finally {
    writing.value = false
    writeProgress.value = ''
    writeNote.value = `Wrote alt text for ${written} of ${sending.length} pictures.`
    if (problems.length) writeError.value = problems.filter((text, index, all) => all.indexOf(text) === index).join(' / ')
  }
}

// Everything the page needs to send these images: which are removed, the primary one, each image's name and crop.
const emit = defineEmits<{ uploaded: [id: string], deleteUpload: [id: string], state: [value: { uploadIds: string[], alts: Record<string, string>, removedIds: string[], primaryId: string | null, names: Record<string, string>, crops: Record<string, Crop> }] }>()
watchEffect(() => {
  emit('state', {
    uploadIds: props.images.filter(image => image.isUpload).map(image => image.id),
    alts: Object.fromEntries(keptImages.value.map(image => [image.id, altOf(image.id)]).filter(([, alt]) => alt)),
    removedIds: [...removedIds.value],
    primaryId: primaryId.value,
    names: Object.fromEntries(props.images.map(image => [image.id, nameOf(image.id)])),
    crops: Object.fromEntries(props.images.filter(image => isCropped(image.id)).map(image => [image.id, cropOf(image.id)]))
  })
})
// Add your own picture: saved on this computer only, and sent to Square with the update.
const uploading = ref(false)
const uploadError = ref('')
async function uploadImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploadError.value = ''
  uploading.value = true
  try {
    const body = new FormData()
    body.append('file', file)
    const { id } = await $fetch<{ id: string }>(`/api/bookish/${props.itemId}/upload`, { method: 'POST', body })
    emit('uploaded', id)
    editingId.value = id
  } catch (err) {
    uploadError.value = (err as { data?: { statusMessage?: string } }).data?.statusMessage || 'Upload failed'
  } finally {
    uploading.value = false
    input.value = ''
  }
}
const smallCount = computed(() => keptImages.value.filter(image => sizeAlert(image.id)).length)
// A removed image that a variation points to leaves that variation without its picture.
const removedWithVariations = computed(() => props.images.filter(image => isRemoved(image.id) && image.variations.length))
</script>

<template>
  <div class="bookish-images">
    <p v-if="smallCount" class="alert warn">
      {{ smallCount }} of {{ keptImages.length }} {{ keptImages.length === 1 ? 'image is' : 'images are' }} smaller than {{ MIN_SIDE }} px on the long side.
    </p>
    <div class="sticker-alt">
      <button type="button" class="big-ai" :disabled="writing || !keptImages.length" @click="writeAltText">
        {{ writing ? `Writing alt text… ${writeProgress}` : `Write alt text with AI (${keptImages.length} picture${keptImages.length === 1 ? '' : 's'})` }}
      </button>
      <span class="none">Sends only the pictures that will go to Square (the pictures alone, no title or description), and only when you press this. Each result lands in that picture's Alt text box for you to edit.</span>
      <p v-if="writeNote" class="none">{{ writeNote }}</p>
      <p v-if="writeError" class="alert bad">{{ writeError }}</p>
    </div>
    <p v-if="duplicateNames" class="alert bad">Two images have the same name. Change one of them.</p>
    <div class="upload-row">
      <label class="upload-label">
        Add your own image
        <input type="file" accept="image/jpeg,image/png,image/webp" :disabled="uploading" @change="uploadImage">
      </label>
      <p v-if="uploadError" class="alert bad">{{ uploadError }}</p>
    </div>
    <p v-if="!images.length" class="none">(no images)</p>
    <p v-else-if="!keptImages.length" class="alert bad">Every image is marked for removal, so the item would have no pictures.</p>
    <p v-if="removedWithVariations.length" class="alert warn">
      Removing {{ removedWithVariations.map(image => image.variations.join(', ')).join('; ') }}'s picture leaves that variation without an image.
    </p>
    <p v-if="removedIds.length" class="none">{{ removedIds.length }} marked for removal: not sent back, and deleted from Square.</p>

    <div v-if="images.length" class="layout">
      <div class="cards">
        <div v-for="image in images" :key="image.id" :class="['card', { selected: editingId === image.id, removed: isRemoved(image.id) }]">
          <img :src="image.url" :data-id="image.id" alt="" @load="recordSize(image.id, $event)">
          <div class="meta">
            <span>{{ dims[image.id] ? `${dims[image.id]!.w}×${dims[image.id]!.h}` : '…' }}<template v-if="optimized[image.id]"> · {{ formatBytes(optimized[image.id]!.sourceBytes) }}</template></span>
            <span :class="{ none: !image.variations.length }">{{ image.variations.length ? image.variations.join(', ') : 'Not tied to a variation' }}</span>
            <span v-if="isCropped(image.id)" class="cropped">Cropped</span>
            <span v-if="sizeAlert(image.id)" :class="['badge', sizeAlert(image.id)!.level]">{{ sizeAlert(image.id)!.level === 'bad' ? 'Very small' : 'Too small' }}</span>
          </div>
          <template v-if="!isRemoved(image.id)">
            <textarea
              class="alt-box"
              rows="3"
              placeholder="Alt text"
              :value="altOf(image.id)"
              :aria-label="`Alt text for ${nameOf(image.id)}`"
              @change="setAlt(image.id, ($event.target as HTMLTextAreaElement).value)"
            />
            <span class="image-name">Name in Square: <code>{{ nameOf(image.id) }}</code></span>
            <button type="button" @click="editingId = editingId === image.id ? null : image.id">
              {{ editingId === image.id ? 'Close' : 'Crop / fit' }}
            </button>
            <span v-if="primaryId === image.id" class="primary-badge">★ Primary (sent first)</span>
            <button v-else type="button" @click="pickedPrimary = image.id">Make primary</button>
          </template>
          <p v-else class="alert bad">Will be deleted from Square.</p>
          <template v-if="image.isUpload">
            <span class="badge warn">Your upload, not in Square yet</span>
            <button type="button" class="danger" @click="emit('deleteUpload', image.id)">Delete upload</button>
          </template>
          <button v-else type="button" :class="{ danger: !isRemoved(image.id) }" @click="toggleRemoved(image.id)">
            {{ isRemoved(image.id) ? 'Keep this image' : 'Remove from Square' }}
          </button>
        </div>
      </div>

      <div class="side">
        <p v-if="!editingImage" class="none">Select an image with “Crop / fit” to see its preview and move or zoom it.</p>
        <template v-else>
          <p><strong>{{ editingImage.variations.length ? editingImage.variations.join(', ') : 'Image' }}</strong> <span v-if="primaryId === editingImage.id" class="primary-badge">★ Primary</span></p>
          <label class="name-edit">
            Name in Square
            <input type="text" :value="nameOf(editingImage.id)" @change="setName(editingImage.id, ($event.target as HTMLInputElement).value)">
            <small class="none">{{ nameOverrides[editingImage.id] ? 'Typed by you. Clear the box to go back to the automatic name.' : 'Automatic. Type to change it.' }}</small>
          </label>
          <p v-if="sizeAlert(editingImage.id)" :class="['alert', sizeAlert(editingImage.id)!.level]">{{ sizeAlert(editingImage.id)!.text }}</p>
          <div class="panels">
            <div>
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
                <button type="button" aria-label="Zoom out a little" :disabled="cropOf(editingImage.id).zoom <= MIN_ZOOM" @click="zoomTo(cropOf(editingImage.id).zoom - ZOOM_STEP)">−</button>
                <input type="range" :min="MIN_ZOOM" :max="MAX_ZOOM" step="0.01" :value="cropOf(editingImage.id).zoom" @input="zoomTo(Number(($event.target as HTMLInputElement).value))">
                <button type="button" aria-label="Zoom in a little" :disabled="cropOf(editingImage.id).zoom >= MAX_ZOOM" @click="zoomTo(cropOf(editingImage.id).zoom + ZOOM_STEP)">+</button>
              </label>
              <p>
                <button type="button" :disabled="!isCropped(editingImage.id)" @click="fitWhole">Fit whole picture</button>
                <button type="button" @click="editingId = null">Done</button>
              </p>
              <p class="none">Drag to move, scroll or use the slider to zoom. Zoom out past the middle to add white around the picture.</p>
            </div>
            <div class="output">
              <strong>Optimized output</strong>
              <template v-if="editingOptimized">
                <img :src="editingOptimized.dataUrl" alt="">
                <div>{{ editingOptimized.width }}×{{ editingOptimized.height }} · {{ formatBytes(editingOptimized.bytes) }} · JPEG quality {{ editingOptimized.quality }}</div>
                <div class="none">
                  Was {{ formatBytes(editingOptimized.sourceBytes) }}
                  <template v-if="editingOptimized.bytes < editingOptimized.sourceBytes">(saves {{ Math.round((1 - editingOptimized.bytes / editingOptimized.sourceBytes) * 100) }}%)</template>
                  <template v-else>(not smaller)</template>
                </div>
                <div class="stale" :class="{ invisible: !isStale(editingImage.id) }">Out of date: the crop changed. Updating the preview…</div>
                <div v-for="warning in editingOptimized.warnings" :key="warning" class="alert warn">{{ warning }}</div>
              </template>
              <p v-else class="none">{{ optimizing ? 'Making preview…' : 'No preview yet.' }}</p>
            </div>
          </div>
        </template>
      </div>
    </div>
    <p v-if="optimizeError" class="alert bad">{{ optimizeError }}</p>
    <p v-if="images.length" class="none">Every image is optimized into the file that would be sent to Square. Nothing is saved or sent yet.</p>
  </div>
</template>

<style scoped>
.none { color: #999; }
.layout { display: flex; flex-wrap: wrap; gap: 1.5rem; align-items: flex-start; }
.cards { display: flex; flex-wrap: wrap; gap: 1rem; flex: 1 1 24rem; }
.card { display: flex; flex-direction: column; gap: 0.35rem; align-items: flex-start; width: 10.5rem; padding: 0.4rem; border: 2px solid transparent; border-radius: 0.4rem; }
.card.removed img { opacity: 0.35; }
.card .alert { margin: 0; }
.card button.danger { color: #b00020; }
.card.selected { border-color: #2f5fb3; }
.card img { height: 10rem; max-width: 100%; object-fit: contain; border: 1px solid #ddd; background: #fff; }
.card button { margin: 0; }
.alt-box { font: inherit; font-size: 0.85rem; width: 100%; box-sizing: border-box; padding: 0.3rem 0.4rem; resize: vertical; }
.upload-row { margin: 0.5rem 0; }
.upload-label { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.85rem; font-weight: 600; }
.big-ai { font-size: 1rem; font-weight: 700; color: #fff; background: #6b4fbb; border: 0; border-radius: 0.5rem; padding: 0.6rem 1.2rem; cursor: pointer; margin: 0 0.75rem 0 0; }
.big-ai:disabled { background: #b8b8b8; cursor: not-allowed; }
.sticker-alt { margin: 0.5rem 0 0.75rem; padding: 0.6rem 0.8rem; background: #f4f7fc; border: 1px solid #d5def0; border-radius: 0.4rem; }
.sticker-fields { display: flex; flex-wrap: wrap; gap: 1rem; margin: 0.4rem 0; }
.sticker-fields label { display: flex; flex-direction: column; gap: 0.2rem; font-weight: 600; font-size: 0.85rem; }
.sticker-fields input { font: inherit; padding: 0.3rem 0.5rem; min-width: 16rem; }
.image-name { font-size: 0.8rem; color: #444; overflow-wrap: anywhere; }
.name-edit { display: flex; flex-direction: column; gap: 0.2rem; font-weight: 600; margin: 0.4rem 0; }
.name-edit input { font: inherit; padding: 0.3rem 0.5rem; }
.meta { display: flex; flex-direction: column; gap: 0.15rem; font-size: 0.8rem; color: #555; overflow-wrap: anywhere; }
.cropped { color: #2f5fb3; font-weight: 600; }
.badge { font-weight: 600; border-radius: 999px; padding: 0.05rem 0.5rem; align-self: flex-start; }
.badge.warn { background: #fff3cd; color: #8a5a00; border: 1px solid #e0b84a; }
.badge.bad { background: #fde7ea; color: #b00020; border: 1px solid #e08a98; }
.primary-badge { font-size: 0.85rem; font-weight: 600; color: #8a5a00; background: #fff3cd; border: 1px solid #e0b84a; border-radius: 999px; padding: 0.2rem 0.7rem; }
.side { flex: 1 1 26rem; position: sticky; top: 1rem; }
.panels { display: flex; flex-wrap: wrap; gap: 1.5rem; }
.output { max-width: 22rem; display: flex; flex-direction: column; gap: 0.3rem; }
.output img { width: 360px; max-width: 100%; aspect-ratio: 1; object-fit: contain; border: 1px solid #ddd; background: #fff; }
.alert { margin: 0.3rem 0; padding: 0.3rem 0.6rem; border-radius: 0.3rem; font-size: 0.85rem; font-weight: 600; }
.alert.warn { background: #fff3cd; color: #8a5a00; border: 1px solid #e0b84a; }
.alert.bad { background: #fde7ea; color: #b00020; border: 1px solid #e08a98; }
.stale { color: #8a6500; font-weight: 600; font-size: 0.85rem; }
.invisible { visibility: hidden; }
.crop-frame { position: relative; overflow: hidden; background: #fff; border: 2px solid #333; cursor: grab; touch-action: none; user-select: none; }
.crop-frame img { position: absolute; max-width: none; pointer-events: none; }
.zoom { display: flex; align-items: center; gap: 0.5rem; margin: 0.5rem 0; }
</style>
