import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const [origin, output] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true })
const results = []
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport })
    await page.goto(`${origin}/m`, { waitUntil: 'networkidle' })
    await page.getByRole('radio', { name: 'Chats', exact: true }).click()
    await page.waitForURL(url => url.pathname.startsWith('/m/chat/') && url.searchParams.get('mode') === 'chats')
    if (viewport.width > 500) {
      await page.locator('.m-chat-row').first().click()
    }
    const chat = new URL(page.url()).pathname
    if (viewport.width <= 500) await page.getByRole('button', { name: 'Back to bots' }).click()
    await page.getByRole('radio', { name: 'Bots', exact: true }).click()
    if (viewport.width <= 500 && new URL(page.url()).pathname !== '/m') await page.getByRole('button', { name: 'Back to bots' }).click()
    await page.getByRole('button', { name: 'Samwise', exact: true }).click()
    const bot = new URL(page.url()).pathname
    if (viewport.width <= 500) await page.getByRole('button', { name: 'Back to bots' }).click()
    await page.getByRole('radio', { name: 'Chats', exact: true }).click()
    await page.waitForURL(url => url.pathname === chat && url.searchParams.get('mode') === 'chats')
    const returnChat = new URL(page.url()).pathname === chat
    if (viewport.width <= 500) await page.getByRole('button', { name: 'Back to bots' }).click()
    await page.getByRole('radio', { name: 'Bots', exact: true }).click()
    await page.waitForURL(url => url.pathname === bot && url.searchParams.get('mode') === 'bots')
    await page.reload({ waitUntil: 'networkidle' })
    const returnBot = new URL(page.url()).pathname === bot && await page.locator('.m-home-switch').getAttribute('data-value') === 'bots'
    const size = viewport.width === 390 ? 'phone' : 'desktop'
    await page.screenshot({ path: `${output}-${size}.png` })
    results.push({ size, chat, bot, returnChat, returnBot })
    await page.close()
  }
  writeFileSync(`${output}.json`, JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results))
  if (results.some(result => !result.returnChat || !result.returnBot)) process.exitCode = 1
} finally { await browser.close() }
