import { expect, test } from '@playwright/test'

// Regression: a MEDIA: image at the end of a list item overlapped the next
// item. Typography's `.prose :where(img)` margin beat the img's `m-0` and
// pushed it out of its aspect-ratio frame, which reserves exactly the image's
// height, so the image drew over the text below.
test('MEDIA: images in a list stay inside their frame and above the next block', async ({ page }) => {
  await page.goto('/e2e/renderer/harness/media-layout.html')

  const frames = page.locator('[data-slot="aui_markdown-image"]')
  await expect(frames).toHaveCount(2)

  for (const img of await frames.locator('img').all()) {
    await expect(img).toHaveJSProperty('complete', true)
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1024)
  }

  const boxes = await frames.evaluateAll(nodes =>
    nodes.map(frame => {
      const img = frame.querySelector('img')!
      const style = getComputedStyle(img)
      // The first block after this image in document order: the next list
      // item, or the paragraph after the list.
      const after = frame.closest('li')!.nextElementSibling ?? frame.closest('ol')!.nextElementSibling!
      const f = frame.getBoundingClientRect()
      const i = img.getBoundingClientRect()

      return {
        frame: { top: f.top, bottom: f.bottom },
        img: { top: i.top, bottom: i.bottom, height: i.height },
        margin: { top: style.marginTop, bottom: style.marginBottom },
        nextTop: after.getBoundingClientRect().top
      }
    })
  )

  for (const box of boxes) {
    expect(box.img.height).toBeGreaterThan(100)
    expect(box.margin).toEqual({ top: '0px', bottom: '0px' })
    expect(box.img.top).toBeGreaterThanOrEqual(box.frame.top - 0.5)
    expect(box.img.bottom).toBeLessThanOrEqual(box.frame.bottom + 0.5)
    expect(box.nextTop).toBeGreaterThanOrEqual(box.img.bottom - 0.5)
  }
})
