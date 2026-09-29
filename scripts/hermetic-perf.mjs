import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const [origin, output] = process.argv.slice(2)
if (!origin || !output) throw new Error('Usage: node hermetic-perf.mjs URL OUTPUT')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(`${origin}/m`, { waitUntil: 'networkidle' })
  if (!await page.getByRole('button', { name: 'Frodo', exact: true }).count()) throw new Error(`Not authenticated: ${page.url()}`)
  await page.evaluate(() => {
    window.__sample = { longTasks: [], frames: [] }
    new PerformanceObserver(list => window.__sample.longTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration })))).observe({ entryTypes: ['longtask'] })
    let previous = performance.now()
    const frame = () => {
      const now = performance.now()
      window.__sample.frames.push(now - previous)
      previous = now
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  const switches = []
  for (const name of ['Frodo', 'Samwise', 'Frodo', 'Samwise']) {
    const start = await page.evaluate(() => performance.now())
    await page.getByRole('button', { name, exact: true }).click()
    await page.waitForURL(new RegExp(`/m/chat/${name === 'Frodo' ? 'default' : 'samwise'}/`))
    await page.getByRole('textbox', { name: 'Message' }).waitFor()
    switches.push({ name, duration: await page.evaluate(start => performance.now() - start, start) })
  }
  const input = page.getByRole('textbox', { name: 'Message' })
  await input.fill('')
  await page.evaluate(() => { window.__sample.pasteFrameStart = window.__sample.frames.length; window.__sample.pasteTaskStart = window.__sample.longTasks.length })
  const paste = []
  const chunk = 'A performance check sentence about the composer and the chat transcript. '.repeat(3).slice(0, 200)
  for (let i = 0; i < 30; i++) {
    const start = await page.evaluate(() => performance.now())
    await input.press('End')
    await page.keyboard.insertText(chunk)
    paste.push({ step: i + 1, duration: await page.evaluate(start => performance.now() - start, start), height: await input.evaluate(el => el.getBoundingClientRect().height) })
  }
  const runtime = await page.evaluate(() => ({ longTasks: window.__sample.longTasks, frames: window.__sample.frames, pasteFrameStart: window.__sample.pasteFrameStart, pasteTaskStart: window.__sample.pasteTaskStart }))
  const pasteFrames = runtime.frames.slice(runtime.pasteFrameStart)
  const summary = { switches, paste, longTasks: runtime.longTasks, frameCount: runtime.frames.length, droppedFrames: runtime.frames.filter(frame => frame > 20).length, maxFrame: Math.max(...runtime.frames), pasteFrameCount: pasteFrames.length, pasteDroppedFrames: pasteFrames.filter(frame => frame > 20).length, pasteLongTasks: runtime.longTasks.slice(runtime.pasteTaskStart) }
  writeFileSync(output, JSON.stringify(summary, null, 2))
  console.log(JSON.stringify({ switches: switches.map(s => +s.duration.toFixed(1)), pasteMax: Math.max(...paste.map(s => s.duration)).toFixed(1), pasteMean: (paste.reduce((a, s) => a + s.duration, 0) / paste.length).toFixed(1), longTasks: runtime.longTasks.length, droppedFrames: summary.droppedFrames, frameCount: summary.frameCount, pasteDroppedFrames: summary.pasteDroppedFrames, pasteFrameCount: summary.pasteFrameCount }))
  await page.close()
} finally {
  await browser.close()
}
