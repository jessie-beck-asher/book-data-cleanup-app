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

function formatDate(iso: string) {
  return new Date(iso).toLocaleString()
}
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <header :class="['env-banner', environment]">
      Square environment: <strong>{{ environment }}</strong>
    </header>
    <main>
      <h1>Book Data Cleanup App</h1>

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
    </main>
  </div>
</template>

<style>
body { font-family: system-ui, sans-serif; margin: 0; }
main { padding: 1rem; }
button { margin-right: 0.5rem; }
.env-banner { padding: 0.5rem 1rem; background: #eee; }
.env-banner.production { background: #f8d7da; }
.env-banner.sandbox { background: #d4edda; }
.confirm { padding: 0.5rem 1rem; border: 1px solid #c90; background: #fff8e1; }
.error { color: #b00020; }
</style>
