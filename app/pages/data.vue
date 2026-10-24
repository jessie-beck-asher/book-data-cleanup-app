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
