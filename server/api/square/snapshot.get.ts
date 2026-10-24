// Says whether a snapshot exists and when it was pulled. Reads only the local file.
export default defineEventHandler(async () => {
  const snapshot = await readSnapshot()
  if (!snapshot) return { exists: false as const }
  return {
    exists: true as const,
    environment: snapshot.environment,
    pulledAt: snapshot.pulledAt,
    ...countBooks(snapshot.items)
  }
})
