// Dry run: builds the before/after diff for one book. Reads the live item from Square (a GET) but sends nothing.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const plan = await makePlan(id)
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
