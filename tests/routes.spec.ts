/**
 * Saved-route persistence + My Routes cards. All these tests mutate the same
 * owner-scoped `routes` data on the shared local test account, so they run
 * SERIALLY (one file, serial mode) to avoid racing each other. Other spec files
 * (planner, smoke, api) don't touch saved routes, so they still run in parallel.
 *
 * Covers: owner-scoped privacy (RBAC), the route-shape thumbnail + card stats
 * (place, distance, time, mode, saved-at), and the detailed-geometry re-snap.
 */
import { test, expect } from 'deepspace/testing'
import type { Locator, Page } from '@playwright/test'
import { markerCount, stubMapServices, waitForMap } from './helpers/planner'

test.describe.configure({ mode: 'serial' })

const THUMB_POLYLINE = 'svg[aria-label="Route shape preview"] polyline'

/**
 * Open My Routes and return the newest card (the one this test just saved —
 * tests run serially, so the most-recent record is always ours). A single
 * navigation keeps the live query subscription connected so the freshly-saved
 * record syncs in; we wait generously rather than reloading (a reload would
 * reset the subscription and delay delivery).
 */
async function openNewestCard(page: Page): Promise<Locator> {
  await page.goto('/routes')
  await page.waitForSelector('[data-testid="my-routes"]', { timeout: 15_000 })
  const card = page.getByTestId('route-card').first()
  await expect(card).toBeVisible({ timeout: 25_000 })
  return card
}

test('a saved route is private to its owner', async ({ users }) => {
  test.setTimeout(75_000)
  const [alice, bob] = await users(2)
  await stubMapServices(alice.page)
  await stubMapServices(bob.page)

  // Bob's baseline.
  await bob.page.goto('/routes')
  await bob.page.waitForSelector('[data-testid="my-routes"]', { timeout: 15000 })
  const bobBefore = await bob.page.getByTestId('route-card').count()

  // Alice plans and saves a route.
  await alice.page.goto('/create')
  await waitForMap(alice.page)
  await alice.page.getByTestId('mode-manual').click()
  await alice.page.mouse.click(450, 320)
  await alice.page.mouse.click(660, 330)
  await expect.poll(() => markerCount(alice.page)).toBe(2)
  await alice.page.getByTestId('save-btn').click()
  await expect(alice.page.getByText('Route saved')).toBeVisible({ timeout: 20000 })

  // Bob cannot see it.
  await bob.page.goto('/routes')
  await bob.page.waitForSelector('[data-testid="my-routes"]', { timeout: 15000 })
  await expect.poll(() => bob.page.getByTestId('route-card').count()).toBe(bobBefore)

  // Cleanup — Alice removes her route (confirm in the ConfirmModal).
  const aliceCard = await openNewestCard(alice.page)
  await aliceCard.getByTestId('route-delete').click()
  await alice.page.getByRole('button', { name: 'Delete', exact: true }).click()
})

test('saved route card shows shape + stats', async ({ users }) => {
  test.setTimeout(60_000)
  const [alice] = await users(1)
  await stubMapServices(alice.page)

  // Plan a manual route (deterministic) and save it.
  await alice.page.goto('/create')
  await waitForMap(alice.page)
  await alice.page.getByTestId('mode-manual').click()
  await alice.page.mouse.click(450, 320)
  await alice.page.mouse.click(660, 330)
  await alice.page.mouse.click(820, 300)
  await expect.poll(() => markerCount(alice.page)).toBe(3)
  await alice.page.getByTestId('save-btn').click()
  await expect(alice.page.getByText('Route saved')).toBeVisible({ timeout: 20_000 })

  const card = await openNewestCard(alice.page)
  await expect(card.locator(THUMB_POLYLINE)).toBeVisible()
  await expect(card.getByTestId('route-card-place')).toContainText('Testville')
  await expect(card.getByText('Manual')).toBeVisible()
  await expect(card.getByTestId('route-card-saved')).toContainText('Saved')

  await card.getByTestId('route-delete').click()
  await alice.page.getByRole('button', { name: 'Delete', exact: true }).click()
})

test('snapped route re-snaps to a detailed shape on the card', async ({ users }) => {
  test.setTimeout(60_000)
  const [alice] = await users(1)
  await stubMapServices(alice.page)
  // Override routing to return a leg with an EXTRA midpoint, so the snapped path
  // has more points than the two anchors — proving the card renders detail, not
  // just a straight anchor-to-anchor line.
  await alice.page.route(/openstreetmap\.de\/route$/, (route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    const [a, b] = body.locations as Array<{ lat: number; lon: number }>
    const mid = { lat: (a.lat + b.lat) / 2 + 0.002, lon: (a.lon + b.lon) / 2 + 0.002 }
    const pairs: Array<[number, number]> = [
      [a.lat, a.lon],
      [mid.lat, mid.lon],
      [b.lat, b.lon],
    ]
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trip: {
          status: 0,
          summary: { length: 1, time: 720 },
          legs: [{ shape: encode6(pairs), summary: { length: 1, time: 720 } }],
        },
      }),
    })
  })

  await alice.page.goto('/create') // foot mode (snapped)
  await waitForMap(alice.page)
  await alice.page.mouse.click(450, 320)
  await alice.page.mouse.click(760, 330)
  await expect.poll(() => markerCount(alice.page)).toBe(2)
  // Wait for the SNAP to land (stubbed leg length = 1 km → 0.62 mi) before
  // saving, so the stored shape is the detailed 3-point path, not the straight
  // haversine placeholder (whose distance is also non-zero).
  await expect(alice.page.getByTestId('distance-value')).toHaveText('0.62')
  await alice.page.getByTestId('save-btn').click()
  await expect(alice.page.getByText('Route saved')).toBeVisible({ timeout: 20_000 })

  const card = await openNewestCard(alice.page)
  const shape = card.locator(THUMB_POLYLINE)
  await expect(shape).toBeVisible({ timeout: 15_000 })

  // The polyline should have more than 2 vertices (the extra snapped midpoint).
  const pointCount = await shape.evaluate((el) => {
    const pts = (el as SVGPolylineElement).getAttribute('points') ?? ''
    return pts.trim().split(/\s+/).filter(Boolean).length
  })
  expect(pointCount).toBeGreaterThan(2)
  await expect(card.getByText('Walk')).toBeVisible()

  await card.getByTestId('route-delete').click()
  await alice.page.getByRole('button', { name: 'Delete', exact: true }).click()
})

/** Precision-6 polyline encoder (Valhalla shape format) — mirrors the helper. */
function encode6(pairs: Array<[number, number]>): string {
  const out: string[] = []
  let prevLat = 0
  let prevLng = 0
  const push = (delta: number) => {
    let x = delta < 0 ? ~(delta << 1) : delta << 1
    while (x >= 0x20) {
      out.push(String.fromCharCode((0x20 | (x & 0x1f)) + 63))
      x >>>= 5
    }
    out.push(String.fromCharCode(x + 63))
  }
  for (const [la, ln] of pairs) {
    const lat = Math.round(la * 1e6)
    const lng = Math.round(ln * 1e6)
    push(lat - prevLat)
    push(lng - prevLng)
    prevLat = lat
    prevLng = lng
  }
  return out.join('')
}
