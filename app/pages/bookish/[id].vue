<script setup lang="ts">
const route = useRoute()
const { data: item, error, refresh } = await useFetch(`/api/bookish/${route.params.id}`)

// Square's copy of just this item is read again (a read only) and replaces the local copy.
const pulling = ref(false)
const pullError = ref('')
async function pullThisItem() {
  pulling.value = true
  pullError.value = ''
  try {
    await $fetch(`/api/books/${route.params.id}/pull`, { method: 'POST' })
    await refresh()
  } catch (err: any) {
    pullError.value = err?.data?.statusMessage || 'Could not pull this item'
  } finally {
    pulling.value = false
  }
}

// SKUs at the top of the page, each with a Copy button (copies "Title - SKU", the same as the list) that says "Copied" for a moment.
const skus = computed(() => [...new Set((item.value?.square.variations ?? []).map(variation => variation.sku.trim()).filter(Boolean))])
const copiedSku = ref<string | null>(null)
async function copySku(sku: string) {
  try {
    await navigator.clipboard.writeText(`${item.value?.square.title ?? ''} - ${sku}`)
    copiedSku.value = sku
    setTimeout(() => {
      if (copiedSku.value === sku) copiedSku.value = null
    }, 1500)
  } catch {
    copiedSku.value = null
  }
}

// The edit form starts with the values pulled from Square. Nothing here is sent to Square yet.
const form = reactive({ title: '', description: '', categoryIds: [] as string[], variationNames: {} as Record<string, string> })
function resetForm() {
  if (!item.value) return
  form.title = item.value.square.title
  form.description = item.value.square.description
  form.categoryIds = [...item.value.square.categoryIds]
  form.variationNames = Object.fromEntries(item.value.square.variations.map(variation => [variation.id, variation.name]))
}
// A title that starts with a size (3.7'', 4 x 6, 4x6 in) takes it out of the title and puts "Measurement: <size>" on the first line of the description.
// A single number needs a unit; a pair like 4x6 does not. "3D" or "3 in 1" are not sizes.
const NUMBER = String.raw`\d+(?:\.\d+)?(?:\s+\d+\/\d+)?`
const UNIT = String.raw`(?:''|"|”|“|″|’’|\s?inches\b|\s?inch\b|\s?in\b(?!\s*\d)|\s?cm\b|\s?mm\b)`
const MEASUREMENT = new RegExp(`^\\s*(${NUMBER}${UNIT}?(?:\\s*[x×]\\s*${NUMBER}${UNIT}?)+|${NUMBER}${UNIT})(?=[\\s,.;:)-]|$)`, 'i')
function measurementOf(title: string) {
  return MEASUREMENT.exec(title)?.[1]?.trim() ?? null
}
function withMeasurement(title: string, description: string) {
  const size = measurementOf(title)
  if (!size || /^\s*measurement:/i.test(description)) return description
  return description ? `Measurement: ${size}\n${description}` : `Measurement: ${size}`
}
// The size is then taken off the front of the title (unless nothing would be left).
function titleWithoutMeasurement(title: string) {
  const match = MEASUREMENT.exec(title)
  const rest = match ? title.slice(match[0].length).replace(/^[\s,.;:)-]+/, '').trim() : ''
  return rest || title
}
// Description clean-up: a run of blank lines collapses to a single blank line between paragraphs (single line breaks stay), spaces at the front of a line are removed, a space goes after a period that runs into the next sentence
// ("end.Next" but not "3.7", "U.S.A" or ".com"), parentheses get a space outside them and none inside, "word/ word" and "2.5- 3" lose the space after the slash or dash.
function cleanDescription(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n(?:[ \t]*\n){2,}/g, '\n\n')
    .replace(/^[ \t]+/gm, '')
    .replace(/([a-z0-9)”"'’])\.(?=[A-Z])/g, '$1. ')
    .replace(/([^\s([{"“'‘])\(/g, '$1 (')
    .replace(/\)(?=[A-Za-z0-9])/g, ') ')
    .replace(/\([ \t]+/g, '(')
    .replace(/[ \t]+\)/g, ')')
    .replace(/(\w)\/[ \t]+(?=\w)/g, '$1/')
    .replace(/(\d)-[ \t]+(?=\w)/g, '$1-')
}
// Title clean-up: a "|" and everything after it is dropped, and the word sticker is capitalized.
function cleanTitle(title: string) {
  const head = title.split('|')[0]!.trim()
  return (head || title).replace(/\bstickers?\b/g, word => word.charAt(0).toUpperCase() + word.slice(1))
}
function startForm() {
  resetForm()
  form.description = cleanDescription(withMeasurement(form.title, form.description))
  form.title = cleanTitle(titleWithoutMeasurement(form.title))
}
startForm()
watch(item, startForm)
// Names are only free text on a variation with no options. With options (Size, Color…) Square builds the name from the option values.
const nameIsLocked = (variation: { options: unknown[] }) => variation.options.length > 0
const nameOf = (variation: { id: string, name: string, options: unknown[] }) => nameIsLocked(variation) ? variation.name : form.variationNames[variation.id] ?? variation.name
// The image names use the variation names as edited here.
const imagesForNaming = computed(() => [...(item.value?.square.images ?? []).map(image => ({
  ...image,
  isUpload: false,
  variationNames: image.variationIds.map((id, index) => {
    const variation = item.value?.square.variations.find(candidate => candidate.id === id)
    return variation ? nameOf(variation) : image.variationNames[index] ?? ''
  })
})), ...(item.value?.uploads ?? []).map(upload => ({ id: upload.id, url: upload.url, variations: [] as string[], variationIds: [] as string[], variationNames: [] as string[], isUpload: true }))])
async function deleteUpload(id: string) {
  if (!item.value) return
  const name = item.value.uploads.find(upload => upload.id === id)?.url.split('/').pop()
  if (!name) return
  await $fetch(`/api/bookish/${item.value.id}/upload/${name}`, { method: 'DELETE' })
  await refresh()
}
// ---- Shipping weight: typed as pounds and ounces, saved as pounds by itself a moment after typing (not sent to Square), for the CSV export later.
const weightLb = ref('')
const weightOz = ref('')
function loadWeight() {
  const pounds = item.value?.weight
  if (pounds == null) {
    weightLb.value = ''
    weightOz.value = ''
    return
  }
  const whole = Math.floor(pounds + 1e-9)
  weightLb.value = String(whole)
  weightOz.value = String(Math.round((pounds - whole) * 16 * 100) / 100)
}
loadWeight()
watch(item, loadWeight)
const weightStatus = ref('')
let weightTimer: ReturnType<typeof setTimeout> | undefined
// undefined = something typed is not a number, null = both boxes empty.
const weightPounds = computed<number | null | undefined>(() => {
  const lb = weightLb.value.trim()
  const oz = weightOz.value.trim()
  if (lb === '' && oz === '') return null
  const lbs = lb === '' ? 0 : Number(lb)
  const ounces = oz === '' ? 0 : Number(oz)
  if (!Number.isFinite(lbs) || !Number.isFinite(ounces) || lbs < 0 || ounces < 0 || lbs + ounces <= 0) return undefined
  return Math.round((lbs + ounces / 16) * 10000) / 10000
})
async function saveWeight() {
  if (!item.value) return
  const pounds = weightPounds.value
  if (pounds === undefined) {
    weightStatus.value = 'Enter numbers above 0 for pounds and/or ounces, or leave both empty.'
    return
  }
  try {
    const saved = await $fetch<{ pounds: number | null }>(`/api/bookish/${item.value.id}/weight`, { method: 'PUT', body: { pounds } })
    weightStatus.value = saved.pounds === null ? 'Cleared' : 'Saved locally'
  } catch (err) {
    weightStatus.value = (err as { statusMessage?: string }).statusMessage || 'Could not save the weight'
  }
}
function weightTyped() {
  weightStatus.value = ''
  clearTimeout(weightTimer)
  weightTimer = setTimeout(saveWeight, 800)
}
onBeforeUnmount(() => clearTimeout(weightTimer))

// ---- Add to Square: review the exact changes first, then send this one item.
const imageState = ref({ uploadIds: [] as string[], alts: {} as Record<string, string>, removedIds: [] as string[], primaryId: null as string | null, names: {} as Record<string, string>, crops: {} as Record<string, { zoom: number, cx: number, cy: number }> })
const editPayload = computed(() => ({
  title: form.title,
  description: form.description,
  categoryIds: [...form.categoryIds],
  variationNames: Object.fromEntries((item.value?.square.variations ?? []).filter(variation => !nameIsLocked(variation)).map(variation => [variation.id, form.variationNames[variation.id] ?? variation.name])),
  images: imageState.value
}))
interface PlanResult { environment: string, canSend: boolean, writesEnabled: boolean, blockers: string[], warnings: string[], rows: { field: string, before: string, after: string, changed: boolean }[] }
const plan = ref<PlanResult | null>(null)
const planning = ref(false)
const sending = ref(false)
const planError = ref('')
const sentMessage = ref('')
const sentProblems = ref<string[]>([])
// The review belongs to the edits it was built from; changing anything after that turns the send button off until it is built again.
const planFor = ref('')
const planStale = computed(() => !!plan.value && planFor.value !== JSON.stringify(editPayload.value))
async function reviewChanges() {
  if (!item.value) return
  planError.value = ''
  sentMessage.value = ''
  planning.value = true
  const payload = JSON.stringify(editPayload.value)
  try {
    plan.value = await $fetch<PlanResult>(`/api/bookish/${item.value.id}/plan`, { method: 'POST', body: JSON.parse(payload) })
    planFor.value = payload
  } catch (err) {
    plan.value = null
    planError.value = (err as { statusMessage?: string }).statusMessage || 'Could not build the review'
  } finally {
    planning.value = false
  }
}
async function sendToSquare() {
  if (!item.value || !plan.value || planStale.value) return
  planError.value = ''
  sending.value = true
  try {
    const result = await $fetch<{ steps: string[], problems: string[] }>(`/api/bookish/${item.value.id}/send`, { method: 'POST', body: { confirm: true, edit: JSON.parse(planFor.value) } })
    plan.value = null
    // Back to the list, which shows the message. If something small went wrong (a rename or delete), stay here so the problems can be read.
    if (!result.problems.length) {
      try {
        sessionStorage.setItem('bookish-toast', JSON.stringify({ message: 'Yay! This item was updated in Square.', problems: [] }))
      } catch {
        // The list just won't show the message.
      }
      window.location.assign('/bookish')
      return
    }
    sentMessage.value = 'This item was updated in Square, but some steps had a problem:'
    sentProblems.value = result.problems
    await refresh()
  } catch (err) {
    const error = err as { statusMessage?: string, data?: { data?: { completedSteps?: string[], blockers?: string[] } } }
    const done = error.data?.data?.completedSteps
    planError.value = `${error.statusMessage || 'Update failed'}${done?.length ? ` (done before it stopped: ${done.join('; ')})` : ''}`
  } finally {
    sending.value = false
  }
}
const parents = computed(() => (item.value?.allCategories ?? []).filter(category => !category.parentId))
// Categories that came in from Square on top; the ones from the owner's category plan below, in plan order.
const squareParents = computed(() => parents.value.filter(parent => !parent.planned))
const plannedParents = computed(() => parents.value.filter(parent => parent.planned)
  .sort((a, b) => (item.value?.plannedOrder ?? []).indexOf(a.name.toLowerCase()) - (item.value?.plannedOrder ?? []).indexOf(b.name.toLowerCase())))
// Everything under a top-level category, deeper levels included, in tree order. Deeper ones are labelled with their path ("Wallet › Passport").
function subsOf(parentId: string, trail: string[] = []): { id: string, name: string, label: string }[] {
  return (item.value?.allCategories ?? []).filter(category => category.parentId === parentId).flatMap(category => [
    { id: category.id, name: category.name, label: [...trail, category.name].join(' › ') },
    ...subsOf(category.id, [...trail, category.name])
  ])
}
// Picking a sub-category also picks its parent. Removing a sub-category leaves the parent as it is.
function toggleCategory(id: string) {
  if (form.categoryIds.includes(id)) {
    form.categoryIds = form.categoryIds.filter(other => other !== id)
    return
  }
  // The whole chain above it is picked too.
  const chain: string[] = []
  for (let parentId = item.value?.allCategories.find(category => category.id === id)?.parentId; parentId; parentId = item.value?.allCategories.find(category => category.id === parentId)?.parentId) {
    if (!form.categoryIds.includes(parentId)) chain.push(parentId)
  }
  form.categoryIds = [...form.categoryIds, id, ...chain]
}
// Picks that are not in the parent/sub list at all (for example a category deleted since the last pull).
const unknownIds = computed(() => form.categoryIds.filter(id => !item.value?.allCategories.some(category => category.id === id)))
const changed = computed(() => !!item.value && (
  form.title !== item.value.square.title
  || form.description !== item.value.square.description
  || form.categoryIds.join('|') !== item.value.square.categoryIds.join('|')
  || item.value.square.variations.some(variation => form.variationNames[variation.id] !== variation.name)
))
</script>

<template>
  <div>
    <p><NuxtLink to="/bookish">&larr; Bookish Items</NuxtLink></p>
    <p v-if="error" class="error">{{ error.statusMessage || 'Could not load this item' }}</p>
    <template v-else-if="item">
      <h1>
        {{ item.square.title || '(untitled)' }}
        <span v-if="item.archived" class="tag">archived</span>
      </h1>
      <div class="sku-row">
        <span class="sku-label">SKU</span>
        <span v-if="!skus.length" class="none">(none)</span>
        <span v-for="sku in skus" :key="sku" class="sku-chip">
          <span class="sku">{{ sku }}</span>
          <button type="button" class="copy" @click="copySku(sku)">{{ copiedSku === sku ? 'Copied' : 'Copy' }}</button>
        </span>
      </div>
      <p class="meta">
        Square item {{ item.id }}, version {{ item.version }}. Local copy pulled {{ new Date(item.pulledAt).toLocaleString() }}.
        <button type="button" :disabled="pulling" @click="pullThisItem">{{ pulling ? 'Pulling…' : 'Pull this item from Square' }}</button>
      </p>
      <p v-if="pullError" class="error">{{ pullError }}</p>

      <h2>Edit</h2>
      <form class="edit-form" @submit.prevent>
        <div class="edit-columns">
          <div class="edit-col">
        <label for="title">Title</label>
        <input id="title" v-model="form.title" type="text">

        <label for="description">Description</label>
        <textarea id="description" v-model="form.description" rows="10" @change="form.description = cleanDescription(form.description)" />

        <label for="weight">Shipping weight</label>
        <div class="weight-row">
          <input id="weight" v-model="weightLb" type="text" inputmode="decimal" aria-label="Pounds" placeholder="0" @input="weightTyped" @blur="saveWeight">
          <span>lb</span>
          <input v-model="weightOz" type="text" inputmode="decimal" aria-label="Ounces" placeholder="0" @input="weightTyped" @blur="saveWeight">
          <span>oz</span>
          <strong v-if="weightPounds">= {{ weightPounds }} lb</strong>
        </div>
        <span :class="['none', { error: weightStatus.startsWith('Enter') }]">{{ weightStatus || 'Saved in pounds on this computer, not sent to Square.' }}</span>
          </div>
          <div class="edit-col">
        <label>Categories</label>
        <div class="cat-picker">
          <div v-for="parent in squareParents" :key="parent.id" class="cat-row">
            <button
              type="button"
              :class="['pill', 'parent-pill', { on: form.categoryIds.includes(parent.id) }]"
              :aria-pressed="form.categoryIds.includes(parent.id)"
              @click="toggleCategory(parent.id)"
            >
              {{ parent.name }}
            </button>
            <div class="cat-subs">
              <button
                v-for="sub in subsOf(parent.id)"
                :key="sub.id"
                type="button"
                :class="['pill', { on: form.categoryIds.includes(sub.id) }]"
                :aria-pressed="form.categoryIds.includes(sub.id)"
                @click="toggleCategory(sub.id)"
              >
                {{ sub.label }}
              </button>
            </div>
          </div>
          <h3 v-if="plannedParents.length" class="cat-heading">My categories</h3>
          <div v-for="parent in plannedParents" :key="parent.id" class="cat-row">
            <button
              type="button"
              :class="['pill', 'parent-pill', { on: form.categoryIds.includes(parent.id) }]"
              :aria-pressed="form.categoryIds.includes(parent.id)"
              @click="toggleCategory(parent.id)"
            >
              {{ parent.name }}
            </button>
            <div class="cat-subs">
              <button
                v-for="sub in subsOf(parent.id)"
                :key="sub.id"
                type="button"
                :class="['pill', { on: form.categoryIds.includes(sub.id) }]"
                :aria-pressed="form.categoryIds.includes(sub.id)"
                @click="toggleCategory(sub.id)"
              >
                {{ sub.label }}
              </button>
            </div>
          </div>
        </div>
        <p v-if="unknownIds.length" class="none">Also on this item (not in the category list): {{ unknownIds.join(', ') }}</p>

          </div>
        </div>

        <label>Images</label>
        <BookishImages :item-id="item.id" :images="imagesForNaming" :title="form.title" :description="form.description" :alt-drafts="item.altDrafts" @state="imageState = $event" @uploaded="refresh()" @delete-upload="deleteUpload" />

        <div class="to-square">
          <button type="button" class="big-button review-button" :disabled="planning || sending" @click="reviewChanges">
            {{ planning ? 'Building review…' : 'Update in Square' }}
          </button>
          <span class="none">Shows exactly what would change for this one item. Nothing is sent until you confirm below.</span>
          <p v-if="planError" class="error">{{ planError }}</p>
          <p v-if="sentMessage" class="sent">{{ sentMessage }}</p>
          <ul v-if="sentProblems.length"><li v-for="problem in sentProblems" :key="problem" class="error">{{ problem }}</li></ul>
          <div v-if="plan" class="plan">
            <table class="book-table plan-table">
              <thead><tr><th>Field</th><th>Now in Square</th><th>After the update</th></tr></thead>
              <tbody>
                <tr v-for="row in plan.rows" :key="row.field" :class="{ changed: row.changed }">
                  <th>{{ row.field }}<span v-if="row.changed" class="tag">changes</span><span v-else class="tag same">unchanged</span></th>
                  <td class="text">{{ row.before }}</td>
                  <td class="text">{{ row.after }}</td>
                </tr>
              </tbody>
            </table>
            <ul v-if="plan.blockers.length"><li v-for="blocker in plan.blockers" :key="blocker" class="error">Blocked: {{ blocker }}</li></ul>
            <ul v-if="plan.warnings.length"><li v-for="warning in plan.warnings" :key="warning" class="warn-note">{{ warning }}</li></ul>
            <p v-if="!plan.writesEnabled" class="error">Writing to production is off for this item, so the button is off. Allow it in data/production-writes.json.</p>
            <p v-if="planStale" class="warn-note">You changed something after this review. Press “Update in Square” again to refresh it.</p>
            <button type="button" class="big-button send" :disabled="!plan.canSend || sending || planning || planStale" @click="sendToSquare">
              {{ sending ? 'Updating…' : `Looks good, update this item in Square (${plan.environment})` }}
            </button>
          </div>
        </div>

        <p class="actions">
          <button type="button" :disabled="!changed" @click="resetForm">Reset to Square values</button>
          <span class="none">{{ changed ? 'Edited (not saved anywhere yet)' : 'Matches Square' }}</span>
        </p>
      </form>

      <h2>Square values</h2>
      <table class="book-table fields">
        <tbody>
          <tr><th>Title</th><td>{{ item.square.title }}</td></tr>
          <tr><th>Description</th><td class="description">{{ item.square.description || '(none)' }}</td></tr>
          <tr><th>Categories</th><td>{{ item.square.categories.join(', ') || '(none)' }}</td></tr>
          <tr v-if="item.square.reportingCategory"><th>Reporting category</th><td>{{ item.square.reportingCategory }}</td></tr>
          <tr><th>Product type</th><td>{{ item.square.productType || '(none)' }}</td></tr>
          <tr>
            <th>Images</th>
            <td>
              <span v-if="!item.square.images.length">(none)</span>
              <div class="gallery">
                <figure v-for="image in item.square.images" :key="image.id">
                  <a :href="image.url" target="_blank" rel="noopener"><img :src="image.url" alt="" class="thumb"></a>
                  <figcaption :class="{ unused: !image.variations.length }">
                    {{ image.variations.length ? image.variations.join(', ') : 'Not tied to a variation' }}
                  </figcaption>
                </figure>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Variations ({{ item.square.variations.length }})</h2>
      <p v-if="item.inventoryError" class="error">Quantities could not be read from Square: {{ item.inventoryError }}</p>
      <table class="book-table">
        <thead>
          <tr><th>Name</th><th>SKU</th><th>GTIN</th><th>Price</th><th>QTY</th><th>Options</th><th>Images</th></tr>
        </thead>
        <tbody>
          <tr v-for="variation in item.square.variations" :key="variation.id">
            <td>
              <input v-if="!nameIsLocked(variation)" v-model="form.variationNames[variation.id]" type="text" class="variation-name" :class="{ edited: form.variationNames[variation.id] !== variation.name }">
              <template v-else>
                {{ variation.name }}
                <span class="tag" title="Square builds this name from the option values (Size, Color…). Option values are shared with other items, so the name is not edited here.">from options</span>
              </template>
            </td>
            <td>{{ variation.sku }}</td>
            <td>{{ variation.gtin }}</td>
            <td>{{ variation.price ?? 'Variable' }}</td>
            <td class="qty">
              <template v-if="variation.quantity !== null">
                {{ variation.quantity }}
                <span v-if="!variation.trackInventory" class="tag" title="Square is not tracking stock for this variation">not tracked</span>
              </template>
              <span v-else class="none">&ndash;</span>
            </td>
            <td>{{ variation.options.map(option => `${option.option}: ${option.value}`).join(', ') }}</td>
            <td>
              <span v-if="!variation.images.length" class="none">None</span>
              <template v-for="image in variation.images" :key="image.id">
                <a v-if="image.url" :href="image.url" target="_blank" rel="noopener"><img :src="image.url" alt="" class="thumb small"></a>
                <span v-else class="none">Image {{ image.id }} not in the local copy</span>
                <span v-if="!image.onItem" class="tag" title="This image is not in the item's own image list">not on item</span>
              </template>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Square data as pulled</h2>
      <pre class="raw">{{ JSON.stringify(item.squareRaw, null, 2) }}</pre>
    </template>
  </div>
</template>

<style scoped>
.meta { color: #555; }
.sku-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem; margin: 0 0 0.5rem; }
.sku-label { font-weight: 600; color: #555; }
.sku-chip { display: inline-flex; align-items: center; gap: 0.5rem; }
.sku { font-size: 1.1rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.copy { font-size: 0.8rem; padding: 0.1rem 0.5rem; margin: 0; }
.weight-row { display: flex; align-items: center; gap: 0.75rem; }
.weight-row input { width: 5rem !important; }
.to-square { margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid #ddd; }
.big-button { display: block; margin: 0 0 0.5rem; padding: 0.8rem 1.6rem; font-size: 1.1rem; font-weight: 700; color: #fff; border: 0; border-radius: 0.6rem; cursor: pointer; }
.big-button:disabled { background: #b8b8b8; color: #f4f4f4; cursor: not-allowed; }
.review-button { background: #2f5fb3; }
.send { background: #1f7a4a; margin-top: 1rem; }
.plan-table { font-size: 0.9rem; }
.plan-table th { width: 11rem; text-align: left; vertical-align: top; }
.plan-table .text { white-space: pre-wrap; word-break: break-word; vertical-align: top; }
.plan-table tr.changed { background: #eef6ff; }
.plan-table .tag.same { background: #eee; color: #555; }
.warn-note { color: #8a6500; font-weight: 600; }
.sent { color: #1f6f43; font-weight: 700; }
.variation-name { font: inherit; padding: 0.25rem 0.4rem; width: 100%; box-sizing: border-box; min-width: 10rem; }
.variation-name.edited { background: #fff8dc; }
.edit-form { display: flex; flex-direction: column; gap: 0.4rem; }
.edit-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 2rem; align-items: start; }
.edit-col { display: flex; flex-direction: column; gap: 0.4rem; }
@media (max-width: 900px) { .edit-columns { grid-template-columns: minmax(0, 1fr); } }
.edit-form label { font-weight: 600; margin-top: 0.5rem; }
.edit-form input[type='text'], .edit-form textarea, .edit-form select { font: inherit; padding: 0.4rem 0.5rem; width: 100%; box-sizing: border-box; }
.edit-form select { width: auto; align-self: flex-start; }
.cat-picker { display: flex; flex-direction: column; gap: 0.6rem; }
.cat-heading { margin: 0.8rem 0 0; font-size: 1rem; }
.cat-row { display: flex; align-items: flex-start; gap: 1rem; }
.parent-pill { flex: none; min-width: 10rem; font-weight: 600; }
.cat-subs { display: flex; flex-wrap: wrap; gap: 0.5rem; padding-left: 1rem; border-left: 1px solid #ddd; min-height: 1.9rem; }
.pill { font: inherit; font-size: 0.9rem; padding: 0.25rem 0.8rem; margin: 0; border: 1px solid #999; border-radius: 999px; background: #fff; color: #333; cursor: pointer; }
.pill.on { background: #1f6f43; border-color: #1f6f43; color: #fff; }
.actions { display: flex; align-items: center; gap: 0.75rem; }
.qty { font-variant-numeric: tabular-nums; }
.fields th { white-space: nowrap; vertical-align: top; }
.description { white-space: pre-wrap; max-width: 50rem; }
.gallery { display: flex; flex-wrap: wrap; gap: 0.75rem; }
.gallery figure { margin: 0; max-width: 9rem; }
.gallery figcaption { font-size: 0.8rem; color: #333; overflow-wrap: anywhere; }
.gallery figcaption.unused, .none { color: #999; }
.thumb { height: 7rem; border: 1px solid #ddd; display: block; }
.thumb.small { height: 4rem; display: inline-block; margin-right: 0.4rem; }
</style>
