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
    <nav>
      <NuxtLink to="/">Books</NuxtLink>
      <NuxtLink to="/data">Data tools</NuxtLink>
    </nav>
    <main>
      <NuxtPage />
    </main>
  </div>
</template>

<style>
body { font-family: system-ui, sans-serif; margin: 0; }
main { padding: 1rem; }
nav { padding: 0.5rem 1rem; border-bottom: 1px solid #ddd; }
nav a { margin-right: 1rem; }
button { margin-right: 0.5rem; }
.env-banner { padding: 0.5rem 1rem; background: #eee; }
.env-banner.production { background: #f8d7da; }
.env-banner.sandbox { background: #d4edda; }
.confirm { padding: 0.5rem 1rem; border: 1px solid #c90; background: #fff8e1; }
.error { color: #b00020; }
.raw { max-height: 32rem; overflow: auto; background: #f6f6f6; padding: 0.75rem; font-size: 0.8rem; }
.book-table { border-collapse: collapse; }
.book-table th, .book-table td { text-align: left; padding: 0.25rem 1.5rem 0.25rem 0; }
.tag { font-size: 0.8rem; color: #666; margin-left: 0.5rem; }
</style>
