import { expect, test } from '@playwright/test'

test('home page loads persona dashboard', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('main')).toBeVisible()
  await expect(page.getByRole('heading', { name: '虚拟人格' })).toBeVisible()
  await expect(page.getByRole('button', { name: '删除虚拟人' })).toBeVisible()
})
