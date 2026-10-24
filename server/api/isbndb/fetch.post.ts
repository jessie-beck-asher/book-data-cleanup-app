// Starts the full ISBNdb fetch in the background. Needs the owner's click ({ confirm: true }) because it uses quota.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ confirm?: boolean }>(event).catch(() => null)
  if (body?.confirm !== true) throw createError({ statusCode: 400, statusMessage: 'The fetch needs your confirmation' })
  if (isbndbJob.running) throw createError({ statusCode: 409, statusMessage: 'A fetch is already running' })
  if (!(await readSnapshot())) throw createError({ statusCode: 400, statusMessage: 'No Square snapshot yet. Pull the catalog first.' })
  if (!(await pendingIsbns()).length) throw createError({ statusCode: 409, statusMessage: 'Every book already has its ISBNdb data saved' })
  await startIsbndbJob()
  return { started: true, job: { ...isbndbJob } }
})
