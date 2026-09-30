import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { chromium } from '@playwright/test'
import { expect, test } from 'vitest'

// Opt-in live dashboard check. Reuses an authenticated browser, never saves cookies.
// PROFILE_AVATAR_CDP=http://127.0.0.1:9222 PROFILE_AVATAR_URL=https://host/m
// PROFILE_AVATAR_EVIDENCE=/absolute/path npm --workspace tests-js test -- profile-avatar.browser.test.ts
const endpoint = process.env.PROFILE_AVATAR_CDP
const url = process.env.PROFILE_AVATAR_URL
const evidence = process.env.PROFILE_AVATAR_EVIDENCE

test.runIf(Boolean(endpoint && url))('account trigger stays circular at rest, hover, press, open and keyboard focus', async () => {
  const browser = await chromium.connectOverCDP(endpoint!)
  const page = await browser.contexts()[0].newPage()
  const results: object[] = []
  let originalTheme = 'system'
  const setTheme = async (theme: string) => {
    await page.goto(new URL('/m/settings', url!).href)
    await page.getByRole('group', { name: 'Appearance', exact: true }).getByRole('button', {
      name: theme[0].toUpperCase() + theme.slice(1), exact: true,
    }).click()
  }
  try {
    if (evidence) { await mkdir(evidence, { recursive: true }) }
    await page.goto(url!)
    await page.locator('button.m-profile-button').waitFor()
    originalTheme = await page.locator('.m-shell').getAttribute('data-theme') ?? 'system'
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      for (const theme of ['light', 'dark']) {
        await setTheme(theme)
        await page.goto(url!)
        const trigger = page.locator('button.m-profile-button')
        await trigger.waitFor()
        await expect.poll(async () => trigger.locator('.m-avatar').first().evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(0)
        const identity = await (await page.request.get(new URL('/api/auth/me', url!).href)).json()
        if (identity.picture) {
          await expect.poll(() => trigger.evaluate(el => el.querySelector('img')?.naturalWidth ?? 0)).toBeGreaterThan(0)
        }
        const capture = async (state: string) => {
          const geometry = await trigger.evaluate(el => {
            const css = getComputedStyle(el)
            const box = el.getBoundingClientRect()
            const image = el.querySelector('img')
            return { width: box.width, height: box.height, radii: [css.borderTopLeftRadius, css.borderTopRightRadius,
              css.borderBottomRightRadius, css.borderBottomLeftRadius], border: css.borderTopWidth,
              hover: el.matches(':hover'), pressed: el.matches(':active'), focused: el.matches(':focus-visible'),
              open: el.getAttribute('data-state') === 'open', photo: image?.naturalWidth ?? 0 }
          })
          expect(geometry.width).toBe(geometry.height)
          expect(geometry.border).not.toBe('0px')
          expect(geometry.radii.every(radius => radius === '50%' || Number.parseFloat(radius) >= geometry.width / 2)).toBe(true)
          if (state === 'hover') { expect(geometry.hover).toBe(true) }
          if (state === 'pressed') { expect(geometry.pressed || geometry.open).toBe(true) }
          if (state === 'focus') { expect(geometry.focused).toBe(true) }
          const file = `${width}-${theme}-${state}.png`
          if (evidence) { await page.screenshot({ path: join(evidence, file) }) }
          results.push({ viewport: width, theme, state, file, ...geometry })
        }
        await page.mouse.move(width - 1, 1)
        await capture('rest')
        await trigger.hover()
        await capture('hover')
        const box = await trigger.boundingBox()
        expect(box).not.toBeNull()
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
        await page.mouse.down()
        await capture('pressed')
        await page.mouse.up()
        await page.keyboard.press('Escape')
        await page.mouse.move(width - 1, 1)
        for (let step = 0; step < 60; step++) {
          await page.keyboard.press('Tab')
          if (await trigger.evaluate(el => el === document.activeElement)) { break }
        }
        await capture('focus')
      }
    }
    expect(results).toHaveLength(16)
  } finally {
    if (evidence) { await writeFile(join(evidence, 'geometry.json'), JSON.stringify(results, null, 2)) }
    await setTheme(originalTheme)
    await page.close()
    await browser.close()
  }
}, 120_000)
