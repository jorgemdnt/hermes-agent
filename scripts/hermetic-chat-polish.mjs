import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const [origin, output, phase = 'after'] = process.argv.slice(2)
if (!origin || !output) throw new Error('Usage: node scripts/hermetic-chat-polish.mjs URL OUTPUT [before|after]')
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const results = []
try {
  for (const width of [390, 1440]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme: theme, hasTouch: width === 390 })
    const page = await context.newPage()
    if (process.env.HERMETIC_POLISH_BACKEND) await page.route('**/api/chat/attachment/**', async route => {
      const response = await route.fetch({ url: new URL(new URL(route.request().url()).pathname, process.env.HERMETIC_POLISH_BACKEND).href })
      await route.fulfill({ response })
    })
    await page.addInitScript(theme => {
      localStorage.setItem('hermes-mobile-theme', theme)
      localStorage.setItem('hermes-mobile-last-bot', 'default')
    }, theme)
    await page.goto(`${origin}/m`, { waitUntil: 'networkidle' })
    if (width === 390) await page.getByRole('button', { name: 'Frodo', exact: true }).click()
    await page.getByRole('textbox', { name: 'Message' }).waitFor()
    await page.locator('.m-message').first().waitFor()
    const capture = async name => page.screenshot({ path: `${output}/${phase}-${width}-${theme}-${name}.png` })
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
    const message = imageCount ? image.locator('..').locator('..') : page.locator('.m-user').last()
    await message.scrollIntoViewIfNeeded()
    await page.mouse.move(0, 0)
    const time = message.locator('time')
    const hiddenOpacity = await time.count() ? await time.evaluate(node => getComputedStyle(node.closest('.m-message-footer') || node).opacity) : null
    const beforeBox = await message.boundingBox()
    if (width === 390) await message.locator('.m-bubble').tap()
    else await message.hover()
    const metadata = await message.evaluate(node => {
      const bubble = node.querySelector('.m-bubble').getBoundingClientRect(), footer = node.querySelector('.m-message-footer'), box = footer.getBoundingClientRect()
      return { position: getComputedStyle(footer).position, right: box.right, bubbleRight: bubble.right, unobscured: footer.contains(document.elementFromPoint(box.right - 8, box.y + box.height / 2)) }
    })
    const visibleOpacity = await time.count() ? await time.evaluate(node => getComputedStyle(node.closest('.m-message-footer') || node).opacity) : null
    const hoverBox = await message.boundingBox()
    await capture('timestamp')
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
    const result = { width, theme, imageCount, single, overlay, metadata, hiddenOpacity, visibleOpacity, timestampHeightStable: beforeBox.height === hoverBox.height, attachments, multiline }
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
      assert.equal(hiddenOpacity, '0')
      assert.equal(visibleOpacity, '1')
      assert(result.timestampHeightStable)
      assert.equal(metadata.position, 'absolute')
      assert.equal(metadata.right, metadata.bubbleRight)
      assert(metadata.unobscured, 'Timestamp controls must not hide behind the next bubble')
      assert(multiline.every(box => Math.abs(box.bottom - multiline[0].bottom) < 1), 'Multiline composer bottom alignment')
      assert(imageCount > 0, 'Exercise a real sent image')
    }
    await context.close()
  }
  console.log(JSON.stringify(results, null, 2))
} finally { await browser.close() }
