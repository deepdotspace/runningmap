import { test, expect } from 'deepspace/testing'
import { captureConsoleErrors } from './helpers/errors'
import { markerCount, stubGeocoding, stubMapServices, waitForMap } from './helpers/planner'

async function waitForApp(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="app-navigation"]', { timeout: 15000 })
}

test.describe('Smoke', () => {
  test('planner loads at / without JS errors', async ({ page }) => {
    await stubMapServices(page)
    const errors = captureConsoleErrors(page)
    await page.goto('/')
    await waitForApp(page)
    await waitForMap(page)
    expect(errors).toEqual([])
  })

  test('navigation and sign-in button are visible when logged out', async ({ page }) => {
    await stubMapServices(page)
    await page.goto('/create')
    await waitForApp(page)
    await expect(page.getByTestId('app-navigation')).toBeVisible()
    await expect(page.getByTestId('nav-sign-in-button')).toBeVisible()
  })

  test('/create is public — planner renders, no auth overlay', async ({ page }) => {
    await stubMapServices(page)
    await page.goto('/create')
    await waitForApp(page)
    await waitForMap(page)
    await expect(page.getByTestId('planner')).toBeVisible()
    await expect(page.getByTestId('mode-foot')).toBeVisible()
    await expect(page.locator('[data-testid="auth-overlay"]')).toHaveCount(0)
  })

  test('/routes is gated when signed out', async ({ page }) => {
    await page.goto('/routes')
    await waitForApp(page)
    await expect(page.locator('[data-testid="auth-overlay"]')).toBeVisible()
    await expect(page.getByTestId('my-routes')).toHaveCount(0)
  })

  test('unknown route shows 404', async ({ page }) => {
    await page.goto('/nonexistent-page-xyz')
    await waitForApp(page)
    await expect(page.locator('text=404')).toBeVisible()
  })

  test('signed-in: save a route, then see and delete it under My Routes', async ({ users }) => {
    test.setTimeout(75_000)
    // Use the 3rd pool account so route writes can't race the collab spec, which
    // mutates the first two accounts in parallel. Client-side navigation (nav
    // links, not page.goto) keeps the live record store, so the freshly-saved
    // record is visible without depending on a reload's server round-trip.
    const [, , user] = await users(3)
    const page = user.page
    await stubMapServices(page)

    const toMyRoutes = () => page.getByRole('link', { name: 'My Routes' }).first().click()

    await page.goto('/create')
    await waitForMap(page)

    // Baseline count.
    await toMyRoutes()
    await page.waitForSelector('[data-testid="my-routes"]', { timeout: 15000 })
    const before = await page.getByTestId('route-card').count()

    // Back to the planner; build a 2-point manual route and save it.
    await page.getByRole('link', { name: 'Planner' }).first().click()
    await waitForMap(page)
    await page.getByTestId('mode-manual').click()
    await page.mouse.click(450, 320)
    await page.mouse.click(660, 330)
    await expect.poll(() => markerCount(page)).toBe(2)
    await page.getByTestId('save-btn').click()
    await expect(page.getByText('Route saved')).toBeVisible({ timeout: 15000 })

    // It shows up under My Routes.
    await toMyRoutes()
    await page.waitForSelector('[data-testid="my-routes"]', { timeout: 15000 })
    await expect
      .poll(() => page.getByTestId('route-card').count(), { timeout: 15000 })
      .toBe(before + 1)

    // Clean up — delete the newest (orderBy createdAt desc → first card),
    // confirming in the ConfirmModal (exact name avoids the per-card
    // "Delete <name>" icon buttons).
    await page.getByTestId('route-delete').first().click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect
      .poll(() => page.getByTestId('route-card').count(), { timeout: 15000 })
      .toBe(before)
  })

  test('signed-out: place search works anonymously (free OSM geocoder, no gate)', async ({
    page,
  }) => {
    await stubMapServices(page)
    await stubGeocoding(page) // stubbed Photon → no real network call

    await page.goto('/create')
    await waitForMap(page)
    // The search box is no longer gated — a logged-out user can type and search.
    await page.getByTestId('search-input').fill('Testville')
    await expect(page.getByTestId('search-results')).toBeVisible()
    const result = page.getByText('Testville, US')
    await expect(result).toBeVisible()
    await result.click()
    // Picking a result flies the map and closes the dropdown.
    await expect(page.getByTestId('search-results')).toHaveCount(0)
  })
})
