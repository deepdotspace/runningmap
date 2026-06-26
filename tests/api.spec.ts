import { test, expect } from '@playwright/test'

test.describe('API', () => {
  test('auth proxy forwards to auth worker', async ({ request }) => {
    const res = await request.get('/api/auth/ok')
    expect(res.ok()).toBeTruthy()
  })

  test('planner route is served (SPA fallback)', async ({ request }) => {
    const res = await request.get('/create')
    expect(res.status()).toBe(200)
  })

  // NOTE: place search now uses free, no-key OSM geocoders (Photon/Nominatim)
  // called directly from the browser — no owner-billed integration, no sign-in.
  // We still never hit them for real in tests: the SearchBox contract is covered
  // by a stubbed page test in smoke.spec.ts.
})
