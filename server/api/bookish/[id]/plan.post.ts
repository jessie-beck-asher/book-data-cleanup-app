// Dry run: builds the before/after diff for one bookish item from the edits on the page. Reads the live item from Square (a GET) but sends nothing.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const edit = parseBookishEdit(await readBody(event).catch(() => null))
  const plan = await makeBookishPlan(id, edit)
  const writesEnabled = await writesEnabledFor(id)
  return {
    environment: plan.environment,
    canSend: writesEnabled && !plan.blockers.length && plan.rows.some(row => row.changed),
    writesEnabled,
    blockers: plan.blockers,
    warnings: plan.warnings,
    rows: plan.rows
  }
})
