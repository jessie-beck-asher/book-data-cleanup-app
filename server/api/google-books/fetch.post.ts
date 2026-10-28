// Starts the Google Books fetch in the background. Needs the owner's click ({ confirm: true }) because it uses Google's daily quota.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ confirm?: boolean }>(event).catch(() => null)
  if (body?.confirm !== true) throw createError({ statusCode: 400, statusMessage: 'The fetch needs your confirmation' })
  if (googleJob.running) throw createError({ statusCode: 409, statusMessage: 'A fetch is already running' })
  if (!(await readSnapshot())) throw createError({ statusCode: 400, statusMessage: 'No Square snapshot yet. Pull the catalog first.' })
  const { inRange, pending } = await googleIsbnsToFetch()
  if (!inRange.length) throw createError({ statusCode: 400, statusMessage: `ISBN ${GOOGLE_START_ISBN} is not in the book list` })
  if (!pending.length) throw createError({ statusCode: 409, statusMessage: 'Every book in range already has its Google Books data saved' })
  await startGoogleJob()
  return { started: true, job: { ...googleJob } }
})
