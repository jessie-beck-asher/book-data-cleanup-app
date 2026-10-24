// Dry run: builds the before/after diff for one book. Reads the live item from Square (a GET) but sends nothing.
export default defineEventHandler(async (event) => {
  const plan = await makePlan(getRouterParam(event, 'id') ?? '')
  return {
    environment: plan.environment,
    canSend: plan.environment === 'sandbox' && !plan.blockers.length && plan.rows.some(row => row.changed),
    writesEnabled: plan.environment === 'sandbox',
    blockers: plan.blockers,
    warnings: plan.warnings,
    rows: plan.rows
  }
})
