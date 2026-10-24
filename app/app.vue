<script setup lang="ts">
const { data } = await useFetch('/api/environment')
const environment = computed(() => data.value?.squareEnvironment ?? 'unknown')
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <header :class="['env-banner', environment]">
      Square environment: <strong>{{ environment }}</strong>
    </header>
    <main>
      <h1>Book Data Cleanup App</h1>
      <p>Phase 0 setup placeholder. No Square or ISBNdb calls yet.</p>
    </main>
  </div>
</template>

<style>
body { font-family: system-ui, sans-serif; margin: 0; }
main { padding: 1rem; }
.env-banner { padding: 0.5rem 1rem; background: #eee; }
.env-banner.production { background: #f8d7da; }
.env-banner.sandbox { background: #d4edda; }
</style>
