import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium, _electron as electron } from 'playwright'

const [origin, output, phase = 'after'] = process.argv.slice(2)
if (!origin || !output) throw new Error('Usage: node scripts/hermetic-chat-polish.mjs URL OUTPUT [before|after]')
mkdirSync(output, { recursive: true })
let nativeApp
let browser
if (process.env.HERMETIC_POLISH_APP) {
  const profile = `${output}/native-profile`
  mkdirSync(profile, { recursive: true })
  writeFileSync(`${profile}/settings.json`, JSON.stringify({ dashboardUrl: `${origin}/m` }))
  writeFileSync(`${profile}/window-state.json`, JSON.stringify({ width: 1440, height: 900 }))
  nativeApp = await electron.launch({ executablePath: process.env.HERMETIC_POLISH_APP, env: { ...process.env, HERMETIC_USER_DATA: profile }, timeout: 60000 })
  await nativeApp.firstWindow()
  await nativeApp.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) { win.webContents.setBackgroundThrottling(false); win.setSize(1440, 900); win.showInactive() } })
  console.log('Isolated installed app PID', nativeApp.process().pid)
} else browser = await chromium.launch({ headless: true, channel: 'chrome' })
const results = []
try {
  for (const width of nativeApp ? [1440] : [390, 1440]) for (const theme of ['light', 'dark']) {
    const context = nativeApp ? nativeApp.context() : await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme: theme, hasTouch: width === 390 })
    const page = nativeApp ? await nativeApp.firstWindow() : await context.newPage()
    if (process.env.HERMETIC_POLISH_BACKEND) await page.route('**/api/chat/attachment/**', async route => {
      const response = await route.fetch({ url: new URL(new URL(route.request().url()).pathname, process.env.HERMETIC_POLISH_BACKEND).href })
      await route.fulfill({ response })
    })
    if (!nativeApp) await page.addInitScript(theme => {
      localStorage.setItem('hermes-mobile-theme', theme)
      localStorage.setItem('hermes-mobile-last-bot', 'default')
    }, theme)
    await page.goto(`${origin}/m`, { waitUntil: 'networkidle' })
    if (nativeApp) {
      await page.evaluate(theme => { localStorage.setItem('hermes-mobile-theme', theme); localStorage.setItem('hermes-mobile-last-bot', 'default') }, theme)
      await page.reload({ waitUntil: 'networkidle' })
    }
    if (width === 390) await page.getByRole('button', { name: 'Frodo', exact: true }).click()
    await page.getByRole('textbox', { name: 'Message' }).waitFor()
    await page.locator('.m-message').first().waitFor()
    const capture = async name => page.screenshot({ path: `${output}/${phase}-${width}-${theme}-${name}.png`, scale: 'css' })
    const editor = page.getByRole('textbox', { name: 'Message' })
    await editor.fill('')
    await page.mouse.move(0, 0)
    const rowBoxes = () => page.locator('.m-composer-row').evaluate(row => [...row.children].filter(node => !node.hidden).map(node => {
      const box = node.getBoundingClientRect(), style = getComputedStyle(node)
      return { className: node.className, height: box.height, center: box.y + box.height / 2, bottom: box.bottom, border: style.borderTopWidth, background: style.backgroundColor }
    }))
    const single = await rowBoxes()
    await page.locator('.m-messages').hover()
    await page.mouse.wheel(0, -400)
    const jump = page.getByRole('button', { name: 'Jump to latest message' })
    await jump.waitFor()
    await capture('scroll')
    const overlay = await jump.evaluate(button => {
      const row = button.parentElement, rowBox = row.getBoundingClientRect(), buttonBox = button.getBoundingClientRect()
      const thread = row.parentElement.querySelector('.m-messages').getBoundingClientRect()
      const style = getComputedStyle(row)
      return { rowWidth: rowBox.width, buttonWidth: buttonBox.width, rowPosition: style.position, background: style.backgroundColor, image: style.backgroundImage, bottom: buttonBox.bottom, threadBottom: thread.bottom }
    })
    await jump.click()
    const image = page.locator('.m-user .m-image-attachment').last()
    await image.locator('img').waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('.m-user .m-image-attachment img')].some(image => image.complete && image.naturalWidth > 0))
    const imageCount = await image.count()
    if (imageCount) {
      await image.scrollIntoViewIfNeeded()
      await capture('sent-image')
    }
    const checkTimestamp = async (message, name) => {
      await message.evaluate(node => { node.scrollIntoView({ block: 'end' }); node.closest('.m-messages').scrollTop += 64 })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await page.mouse.move(0, 0)
      const footer = message.locator('.m-message-footer')
      const hiddenOpacity = await footer.evaluate(node => getComputedStyle(node).opacity)
      const before = await page.locator('.m-message').evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect()
        return { x: box.x, y: box.y, width: box.width, height: box.height }
      }))
      const box = await message.locator('.m-bubble').boundingBox()
      if (width === 390) await page.touchscreen.tap(box.x + 5, box.y + box.height - 15)
      else await page.mouse.move(box.x + box.width - 14, box.y + box.height - 12)
      const metadata = await message.evaluate(node => {
        const row = node.getBoundingClientRect(), bubble = node.querySelector('.m-bubble').getBoundingClientRect()
        const footer = node.querySelector('.m-message-footer'), box = footer.getBoundingClientRect(), style = getComputedStyle(footer)
        const contains = bounds => box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom
        const hit = document.elementFromPoint(box.right - 8, box.y + box.height / 2)
        return { position: style.position, right: box.right, bubbleRight: bubble.right, background: style.backgroundColor, fade: style.backgroundImage, withinRow: contains(row), withinBubble: contains(bubble), unobscured: footer.contains(hit), hitClass: hit?.className, footerRect: box.toJSON(), rowRect: row.toJSON() }
      })
      const visibleOpacity = await footer.evaluate(node => getComputedStyle(node).opacity)
      const after = await page.locator('.m-message').evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect()
        return { x: box.x, y: box.y, width: box.width, height: box.height }
      }))
      await capture(name)
      if (width === 390) await page.touchscreen.tap(box.x + 5, box.y + box.height - 15)
      const geometryStable = JSON.stringify(before) === JSON.stringify(after)
      writeFileSync(`${output}/${phase}-${width}-${theme}-${name}.json`, JSON.stringify({ hiddenOpacity, visibleOpacity, geometryStable, ...metadata }, null, 2))
      if (phase !== 'before') {
        assert.equal(hiddenOpacity, '0')
        assert.equal(visibleOpacity, '1')
        assert(geometryStable, 'No message or neighbor may move on hover/tap')
        assert.equal(metadata.position, 'absolute')
        assert(metadata.withinRow && metadata.withinBubble, 'Timestamp must overlay its own bubble, not the inter-message gap')
        assert(metadata.bubbleRight - metadata.right <= 10, 'Timestamp stays on the bubble edge')
        assert.equal(metadata.background, 'rgba(0, 0, 0, 0)')
        assert.notEqual(metadata.fade, 'none')
        assert(metadata.unobscured, 'Timestamp controls must not hide behind the next bubble')
      }
      return { hiddenOpacity, visibleOpacity, geometryStable, neighborCount: before.length, ...metadata }
    }
    const message = imageCount ? image.locator('..').locator('..') : page.locator('.m-user').last()
    const middleTimestamp = await checkTimestamp(message, 'timestamp')
    const lastTimestamp = await checkTimestamp(page.locator('.m-message:has(.m-message-footer time)').last(), 'timestamp-last')
    const photos = page.locator('input[type="file"][accept]')
    const attachmentPaths = [
      process.env.HERMETIC_POLISH_IMAGE || `${process.env.HOME}/.hermes/images/dashboard_20260929_222213_100c1cdc_image.png`,
      `${process.env.HOME}/.hermes/images/dashboard_20260929_222213_a2989732_image.png`,
      `${process.env.HOME}/.hermes/images/dashboard_20260929_222213_b3e9e43a_image.png`,
    ]
    await photos.setInputFiles(attachmentPaths[0])
    await capture('one-attachment')
    await photos.setInputFiles(attachmentPaths.slice(1))
    await capture('three-attachments')
    const attachments = await page.locator('.m-photo-preview').evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect(), button = node.querySelector('button').getBoundingClientRect(), image = node.querySelector('img').getBoundingClientRect()
      return { height: box.height, buttonInside: button.left >= box.left && button.right <= box.right && button.top >= box.top && button.bottom <= box.bottom, imageWidth: image.width, imageHeight: image.height, fit: getComputedStyle(node.querySelector('img')).objectFit }
    }))
    for (let index = 0; index < 3; index++) await page.locator('.m-photo-preview button').first().click()
    await editor.fill('First line\nSecond line\nThird line')
    const multiline = await rowBoxes()
    await capture('multiline')
    await editor.fill('')
    const result = { width, theme, imageCount, single, overlay, middleTimestamp, lastTimestamp, attachments, multiline }
    results.push(result)
    writeFileSync(`${output}/${phase}-measurements.json`, JSON.stringify(results, null, 2))
    if (phase !== 'before') {
      assert.equal(overlay.rowPosition, 'absolute', 'Jump must float, not reserve a full-width row')
      assert.equal(overlay.rowWidth, overlay.buttonWidth, 'No full-width backdrop behind jump')
      assert.equal(overlay.background, 'rgba(0, 0, 0, 0)')
      assert.equal(overlay.image, 'none')
      assert(overlay.bottom <= overlay.threadBottom && overlay.bottom >= overlay.threadBottom - 24)
      assert(single.every(box => Math.abs(box.height - single[0].height) < 1 && Math.abs(box.center - single[0].center) < 1), 'Single-line composer alignment')
      assert(attachments.every(chip => chip.buttonInside && chip.imageWidth === chip.imageHeight && chip.fit === 'cover'))

      assert(multiline.every(box => Math.abs(box.bottom - multiline[0].bottom) < 1), 'Multiline composer bottom alignment')
      assert(imageCount > 0, 'Exercise a real sent image')
    }
    if (!nativeApp) await context.close()
  }
  console.log(JSON.stringify(results, null, 2))
} finally { if (nativeApp) await nativeApp.close(); else await browser.close() }
