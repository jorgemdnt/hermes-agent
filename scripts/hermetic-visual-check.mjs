import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const [origin, output] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true })
const results = []
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport })
    await page.goto(`${origin}/m`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Frodo', exact: true }).click()
    const input = page.getByRole('textbox', { name: 'Message' })
    await input.fill('A 200-character paragraph about keyboard responsiveness and layout growth. '.repeat(90))
    await page.locator('.m-messages').evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new WheelEvent('wheel', { bubbles: true })) })
    await page.getByRole('button', { name: 'Jump to latest message' }).waitFor()
    const send = page.getByRole('button', { name: 'Send' })
    const jump = page.getByRole('button', { name: 'Jump to latest message' })
    const composer = page.locator('.m-composer')
    const [sendBox, jumpBox, composerBox, inputBox] = await Promise.all([send.boundingBox(), jump.boundingBox(), composer.boundingBox(), input.boundingBox()])
    const clear = jumpBox.y + jumpBox.height <= composerBox.y && jumpBox.y + jumpBox.height <= sendBox.y
    const size = viewport.width === 390 ? 'phone' : 'desktop'
    await page.screenshot({ path: `${output}-${size}.png` })
    results.push({ size, clear, sendBox, jumpBox, composerBox, inputHeight: inputBox.height })
    await page.close()
  }
  writeFileSync(`${output}.json`, JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results.map(({ size, clear, inputHeight }) => ({ size, clear, inputHeight }))))
  if (results.some(result => !result.clear)) process.exitCode = 1
} finally { await browser.close() }
