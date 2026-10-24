<script setup lang="ts">
const { data } = await useFetch('/api/books')
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
              <NuxtLink :to="`/books/${book.id}`">{{ book.title }}</NuxtLink>
              <span v-if="book.archived" class="tag">archived</span>
            </td>
            <td>{{ book.wasUpdated ? 'Yes' : 'No' }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
