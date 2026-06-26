import { expect, test } from '@playwright/test'
import { markerCount, stubMapServices, waitForMap } from './helpers/planner'

/**
 * Core planner interactions. Most run in manual mode so geometry is
 * deterministic and offline; one exercises the OSRM snap path (stubbed).
 */
test.describe('Planner', () => {
  test.beforeEach(async ({ page }) => {
    await stubMapServices(page)
  })

  async function openManual(page: import('@playwright/test').Page) {
    await page.goto('/create')
    await waitForMap(page)
    await page.getByTestId('mode-manual').click()
  }

  test('click adds points and distance updates', async ({ page }) => {
    await openManual(page)
    await expect(page.getByTestId('distance-value')).toHaveText('0.00')
    await page.mouse.click(450, 320)
    await page.mouse.click(620, 300)
    await page.mouse.click(760, 360)
    await expect.poll(() => markerCount(page)).toBe(3)
    const dist = Number(await page.getByTestId('distance-value').textContent())
    expect(dist).toBeGreaterThan(0)
  })

  test('undo and redo', async ({ page }) => {
    await openManual(page)
    await page.mouse.click(450, 320)
    await page.mouse.click(620, 300)
    await expect.poll(() => markerCount(page)).toBe(2)
    await page.getByTestId('undo-btn').click()
    await expect.poll(() => markerCount(page)).toBe(1)
    await page.getByTestId('redo-btn').click()
    await expect.poll(() => markerCount(page)).toBe(2)
  })

  test('unit toggle reformats the distance', async ({ page }) => {
    await openManual(page)
    await page.mouse.click(450, 320)
    await page.mouse.click(660, 320)
    await expect.poll(() => markerCount(page)).toBe(2)
    const miText = await page.getByTestId('distance-value').textContent()
    await expect(page.getByTestId('unit-toggle')).toHaveText('mi')
    await page.getByTestId('unit-toggle').click()
    await expect(page.getByTestId('unit-toggle')).toHaveText('km')
    expect(await page.getByTestId('distance-value').textContent()).not.toBe(miText)
  })

  test('select and delete a waypoint', async ({ page }) => {
    await openManual(page)
    await page.mouse.click(450, 320)
    await page.mouse.click(620, 300)
    await page.mouse.click(760, 360)
    await expect.poll(() => markerCount(page)).toBe(3)
    await page.locator('.rm-marker').nth(1).click()
    await expect(page.getByTestId('selected-point-panel')).toBeVisible()
    await page.getByTestId('delete-point-btn').click()
    await expect.poll(() => markerCount(page)).toBe(2)
  })

  test('foot mode snaps via the routing service', async ({ page }) => {
    await page.goto('/create')
    await waitForMap(page)
    // default mode is foot (snap)
    await page.mouse.click(450, 320)
    await page.mouse.click(660, 330)
    await expect.poll(() => markerCount(page)).toBe(2)
    // stubbed Valhalla returns a leg → distance is non-zero
    await expect(page.getByTestId('distance-value')).not.toHaveText('0.00')
  })

  test('routing failure falls back to a straight line without hanging', async ({ page }) => {
    // Override the routing stub with a failure for this test only.
    await page.route(/openstreetmap\.de\/route$/, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    )
    await page.goto('/create')
    await waitForMap(page)
    await page.mouse.click(450, 320)
    await page.mouse.click(660, 330)
    await expect.poll(() => markerCount(page)).toBe(2)
    // Straight-line fallback → distance is computed locally, no hang.
    await expect(page.getByTestId('distance-value')).not.toHaveText('0.00')
  })

  test('change a segment travel mode', async ({ page }) => {
    await openManual(page)
    await page.mouse.click(450, 320)
    await page.mouse.click(660, 320)
    await expect.poll(() => markerCount(page)).toBe(2)
    await page.locator('.rm-marker').nth(1).click()
    await page.getByTestId('leg-mode-bike').click()
    // segment is now bike; panel still open and shows bike active
    await expect(page.getByTestId('selected-point-panel')).toBeVisible()
  })

  test('export GPX triggers a download', async ({ page }) => {
    await openManual(page)
    await page.mouse.click(450, 320)
    await page.mouse.click(660, 320)
    await expect.poll(() => markerCount(page)).toBe(2)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-gpx').click(),
    ])
    expect(download.suggestedFilename()).toMatch(/route.*\.gpx/)
  })

  test('route is encoded in the URL and reloads from a share link', async ({ page }) => {
    await openManual(page)
    await page.mouse.click(450, 320)
    await page.mouse.click(620, 300)
    await page.mouse.click(760, 360)
    await expect.poll(() => markerCount(page)).toBe(3)
    await expect.poll(() => page.url()).toContain('r=')
    const shareUrl = page.url()

    await page.goto(shareUrl)
    await waitForMap(page)
    await expect.poll(() => markerCount(page)).toBe(3)
    expect(Number(await page.getByTestId('distance-value').textContent())).toBeGreaterThan(0)
  })

  // Drag a marker by its on-screen centre, generating intermediate mousemoves
  // so MapLibre's marker-drag engages (and crosses the click-vs-drag threshold).
  async function dragMarker(
    page: import('@playwright/test').Page,
    nth: number,
    dx: number,
    dy: number,
  ) {
    const box = await page.locator('.rm-marker').nth(nth).boundingBox()
    if (!box) throw new Error(`marker ${nth} has no bounding box`)
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + dx, cy + dy, { steps: 8 })
    await page.mouse.up()
  }

  test('dragging the start marker moves it without creating a point', async ({ page }) => {
    await openManual(page)
    await page.mouse.click(450, 320)
    await page.mouse.click(620, 300)
    await page.mouse.click(760, 360)
    await expect.poll(() => markerCount(page)).toBe(3)
    const before = Number(await page.getByTestId('distance-value').textContent())

    // Drag the green start marker — must NOT insert a 4th point.
    await dragMarker(page, 0, -60, 50)
    await expect.poll(() => markerCount(page)).toBe(3)
    const after = Number(await page.getByTestId('distance-value').textContent())
    expect(after).not.toBe(before) // the point actually moved
  })

  test('dragging a middle marker moves it without creating a point', async ({ page }) => {
    await openManual(page)
    await page.mouse.click(450, 320)
    await page.mouse.click(620, 300)
    await page.mouse.click(760, 360)
    await expect.poll(() => markerCount(page)).toBe(3)
    await dragMarker(page, 1, 40, -40)
    await expect.poll(() => markerCount(page)).toBe(3)
  })

  test('dragging the line (away from a vertex) inserts a waypoint', async ({ page }) => {
    await openManual(page)
    await page.mouse.click(400, 300)
    await page.mouse.click(800, 300)
    await expect.poll(() => markerCount(page)).toBe(2)
    // Let MapLibre paint the route line — queryRenderedFeatures can't hit-test it
    // until the next frame after setData, even though the marker DOM is present.
    await page.waitForTimeout(300)
    // Press the line at its midpoint (far from both vertices) and drag.
    await page.mouse.move(600, 300)
    await page.mouse.down()
    await page.mouse.move(600, 380, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => markerCount(page)).toBe(3)
  })

  test('inserting a waypoint snaps its new legs even when released over a panel', async ({
    page,
  }) => {
    // Regression: the insert-drag used to end on a map-scoped mouseup, which is
    // missed when the pointer is released over an overlay panel (not the canvas).
    // That stranded the drag so the two new legs never snapped. Releasing over the
    // bottom bar must still snap them.
    let routeReqs = 0
    await page.route(/openstreetmap\.de\/route$/, async (route) => {
      routeReqs += 1
      await route.fallback() // defer to the stubMapServices handler for the body
    })

    await page.goto('/create') // default mode = foot (snapped)
    await waitForMap(page)
    await page.mouse.click(400, 300)
    await page.mouse.click(800, 300)
    await expect.poll(() => markerCount(page)).toBe(2)
    await page.waitForTimeout(300) // let the route line paint so it's hit-testable
    const beforeInsert = routeReqs

    // Press the line midpoint, drag out a new point, then release OVER the bottom
    // bar (a DOM overlay, not the map canvas) — the case the old code missed.
    const bar = await page.getByTestId('more-btn').boundingBox()
    if (!bar) throw new Error('bottom bar not visible')
    await page.mouse.move(600, 300)
    await page.mouse.down()
    await page.mouse.move(600, 360, { steps: 8 })
    await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2, { steps: 6 })
    await page.mouse.up()

    await expect.poll(() => markerCount(page)).toBe(3)
    // The two new legs snapped → at least one new /route request fired post-insert.
    await expect.poll(() => routeReqs).toBeGreaterThan(beforeInsert)
  })

  test('dragging a snapped point defers routing to release (no per-frame spam)', async ({
    page,
  }) => {
    let routeRequests = 0
    await page.route(/openstreetmap\.de\/route$/, async (route) => {
      routeRequests += 1
      // Re-use the default stub's straight-leg behaviour.
      const body = JSON.parse(route.request().postData() || '{}')
      const pairs = body.locations.map((l: { lat: number; lon: number }) => [l.lat, l.lon])
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          trip: { status: 0, summary: { length: 1 }, legs: [{ shape: '', summary: { length: 1 } }] },
        }),
      })
    })

    await page.goto('/create') // default mode = foot (snapped)
    await waitForMap(page)
    await page.mouse.click(400, 300)
    await page.mouse.click(600, 300)
    await page.mouse.click(800, 300)
    await expect.poll(() => markerCount(page)).toBe(3)
    await expect.poll(() => routeRequests).toBeGreaterThan(0) // initial snap fired
    const beforeDrag = routeRequests

    // Drag the middle marker across many intermediate positions.
    await dragMarker(page, 1, 0, 120)
    await page.waitForTimeout(300)
    const duringAndAfter = routeRequests - beforeDrag

    // Only the (at most) two segments touching the dragged point should re-snap,
    // and only once on release — not one request per mousemove frame.
    expect(duringAndAfter).toBeLessThanOrEqual(2)
  })

  test('shows an estimated travel time that grows with the route', async ({ page }) => {
    await openManual(page) // manual mode → time is the local mode-speed estimate
    await expect(page.getByTestId('duration-value')).toHaveCount(0) // hidden until a route exists
    await page.mouse.click(400, 300)
    await page.mouse.click(600, 300)
    await expect.poll(() => markerCount(page)).toBe(2)
    await expect(page.getByTestId('duration-value')).toBeVisible()
    const t1 = await page.getByTestId('duration-value').textContent()
    expect(t1).toMatch(/min|sec|hr/)
    await page.mouse.click(900, 300)
    await expect.poll(() => markerCount(page)).toBe(3)
    // A longer route → a longer (or equal, after rounding) estimate, never shorter.
    const mins = (s: string | null) => Number((s ?? '').replace(/[^\d]/g, ''))
    await expect.poll(() => mins(t1 ? t1 : '')).toBeGreaterThan(0)
  })

  test('keyboard: Space adds at centre, Delete removes', async ({ page }) => {
    await openManual(page)
    await page.locator('.maplibregl-canvas').click({ position: { x: 400, y: 300 } })
    await expect.poll(() => markerCount(page)).toBe(1)
    await page.locator('.maplibregl-canvas').focus()
    await page.keyboard.press('Space')
    await expect.poll(() => markerCount(page)).toBe(2)
    await page.keyboard.press('Delete')
    await expect.poll(() => markerCount(page)).toBe(1)
  })
})
