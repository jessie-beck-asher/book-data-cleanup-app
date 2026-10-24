<script setup lang="ts">
const { data } = await useFetch('/api/environment')
const environment = computed(() => data.value?.squareEnvironment ?? 'unknown')

const { data: snapshot, refresh: refreshSnapshot } = await useFetch('/api/square/snapshot')

const pulling = ref(false)
const errorMessage = ref('')
const needsConfirm = ref<{ environment: string, pulledAt: string } | null>(null)

async function pull(replace: boolean) {
  pulling.value = true
  errorMessage.value = ''
  try {
    await $fetch('/api/square/pull', { method: 'POST', body: { replace } })
    needsConfirm.value = null
    await refreshSnapshot()
  } catch (error: any) {
    if (error?.statusCode === 409 && error?.data?.data?.pulledAt) {
      needsConfirm.value = error.data.data
    } else {
      errorMessage.value = error?.data?.statusMessage ?? 'Pull failed'
    }
  } finally {
    pulling.value = false
  }
}

const testing = ref(false)
const testError = ref('')
const testResult = ref<any>(null)

async function runIsbndbTest() {
  testing.value = true
  testError.value = ''
  try {
    testResult.value = await $fetch('/api/isbndb/test', { method: 'POST' })
  } catch (error: any) {
    testError.value = [error?.data?.statusMessage, error?.data?.data?.message].filter(Boolean).join(': ') || 'ISBNdb test failed'
  } finally {
    testing.value = false
  }
}

// Full ISBNdb fetch: counts, one confirming click, then progress while it runs in the background.
interface IsbndbStatus {
  totalBooks: number, alreadySaved: number, found: number, noMatch: number, pending: number, wouldRequest: number, dailyLimit: number
  batches: number, coversSaved: number, coversMissing: number
  job: { running: boolean, planned: number, fetched: number, batchesDone: number, batchesTotal: number, coversSaved: number, coversFailed: number, noMatch: number, finishedAt: string | null, error: string | null }
}
const { data: isbndb, refresh: refreshIsbndb } = await useFetch<IsbndbStatus>('/api/isbndb/status')
const fetchError = ref('')
let poller: ReturnType<typeof setInterval> | undefined
function watchJob() {
  clearInterval(poller)
  poller = setInterval(async () => {
    await refreshIsbndb()
    if (!isbndb.value?.job.running) clearInterval(poller)
  }, 2000)
}
async function startFetch() {
  fetchError.value = ''
  try {
    await $fetch('/api/isbndb/fetch', { method: 'POST', body: { confirm: true } })
    await refreshIsbndb()
    watchJob()
  } catch (error: any) {
    fetchError.value = error?.data?.statusMessage ?? 'Could not start the fetch'
  }
}
onMounted(() => { if (isbndb.value?.job.running) watchJob() })
onBeforeUnmount(() => clearInterval(poller))

function formatDate(iso: string) {
  return new Date(iso).toLocaleString()
}
</script>

<template>
  <div>
    <h1>Data tools</h1>

    <section>
      <h2>Square catalog snapshot</h2>
      <p v-if="snapshot?.exists">
        Last pulled {{ formatDate(snapshot.pulledAt) }} from <strong>{{ snapshot.environment }}</strong>:
        {{ snapshot.totalItems }} items, {{ snapshot.books }} with a valid ISBN,
        {{ snapshot.skipped }} without a valid ISBN, {{ snapshot.conflicting }} conflicting.
      </p>
      <p v-else>No snapshot yet.</p>

      <button v-if="!needsConfirm" :disabled="pulling" @click="pull(false)">
        {{ pulling ? 'Pulling…' : 'Pull catalog from Square (read-only)' }}
      </button>

      <div v-if="needsConfirm" class="confirm">
        <p>
          A snapshot from <strong>{{ needsConfirm.environment }}</strong> pulled
          {{ formatDate(needsConfirm.pulledAt) }} already exists. Replace it with a new pull from
          <strong>{{ environment }}</strong>?
        </p>
        <button :disabled="pulling" @click="pull(true)">{{ pulling ? 'Pulling…' : 'Yes, replace it' }}</button>
        <button :disabled="pulling" @click="needsConfirm = null">Cancel</button>
      </div>

      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
    </section>

    <section v-if="snapshot?.exists && isbndb">
      <h2>ISBNdb data for all books</h2>
      <p>
        {{ isbndb.totalBooks }} books in the snapshot. Saved so far: {{ isbndb.alreadySaved }}
        ({{ isbndb.found }} found, {{ isbndb.noMatch }} no match). Original covers saved: {{ isbndb.coversSaved }} of {{ isbndb.found }}.
      </p>
      <template v-if="isbndb.job.running">
        <p>
          Fetching: batch {{ isbndb.job.batchesDone }} of {{ isbndb.job.batchesTotal }}
          ({{ isbndb.job.fetched }} of {{ isbndb.job.planned }} books). Covers saved: {{ isbndb.job.coversSaved }},
          cover downloads failed: {{ isbndb.job.coversFailed }}. Keep this app running until it finishes. It is safe to stop; the next run continues where this one left off.
        </p>
      </template>
      <template v-else>
        <p v-if="isbndb.pending">
          {{ isbndb.pending }} books still need their ISBNdb data. This run would request {{ isbndb.wouldRequest }} ISBNs in {{ isbndb.batches }} batches
          and use {{ isbndb.wouldRequest }} of your {{ isbndb.dailyLimit }} daily lookups. Each batch's covers are saved right away.
        </p>
        <p v-else>Every book already has its ISBNdb data saved. Nothing to fetch.</p>
        <button v-if="isbndb.pending" @click="startFetch">
          Fetch {{ isbndb.wouldRequest }} books from ISBNdb ({{ isbndb.wouldRequest }} lookups)
        </button>
        <p v-if="isbndb.job.finishedAt && !isbndb.job.error">
          Last run finished: {{ isbndb.job.fetched }} books, {{ isbndb.job.noMatch }} with no match, {{ isbndb.job.coversSaved }} covers saved, {{ isbndb.job.coversFailed }} cover downloads failed.
        </p>
      </template>
      <p v-if="isbndb.job.error" class="error">The last run stopped: {{ isbndb.job.error }}. Everything fetched before that is saved; run it again to continue.</p>
      <p v-if="fetchError" class="error">{{ fetchError }}</p>
    </section>

    <section v-if="snapshot?.exists">
      <h2>ISBNdb test (first 5 books)</h2>
      <p>One batch request for 5 ISBNs (uses 5 of your daily lookups). ISBNs already saved are not requested again.</p>
      <button :disabled="testing" @click="runIsbndbTest">{{ testing ? 'Fetching…' : 'Fetch 5 test books from ISBNdb' }}</button>
      <p v-if="testError" class="error">{{ testError }}</p>
      <div v-if="testResult">
        <p>
          Requested {{ testResult.asked }} ISBNs this time (ISBNdb reports requested: {{ testResult.requested }},
          total: {{ testResult.total }}). Saved to {{ testResult.savedTo }}.
        </p>
        <ol>
          <li v-for="book in testResult.books" :key="book.number">
            Book {{ book.number }}: {{ book.status }}{{ book.fromCache ? ' (from saved file)' : '' }}
            <div v-if="book.status === 'found'">
              Fields: {{ book.fields.join(', ') }}
              <br>Weight/dimensions: {{ Object.keys(book.weightLike).length ? JSON.stringify(book.weightLike) : 'none' }}
              <br>Image host: {{ book.imageHost ?? 'none' }}
            </div>
          </li>
        </ol>
        <details open>
          <summary>Raw JSON saved for these 5 books</summary>
          <pre class="raw">{{ JSON.stringify(testResult.raw, null, 2) }}</pre>
        </details>
      </div>
    </section>
  </div>
</template>
