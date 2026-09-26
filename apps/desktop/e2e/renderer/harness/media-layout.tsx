// Renderer-only harness: the real MessageTextContent with the real compiled
// styles.css, no Electron and no backend. `window.hermesDesktop` is reduced to
// the one bridge call a local MEDIA: image needs, answering with a 1024x1024
// JPEG drawn on a canvas (the shape of the repro's avatar images).
import '@/styles.css'

import { createRoot } from 'react-dom/client'

import { MessageTextContent } from '@/components/assistant-ui/markdown-text'

function squareJpeg(color: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 1024
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1024, 1024)

  return canvas.toDataURL('image/jpeg', 0.6)
}

const images: Record<string, string> = {
  '/tmp/hermes-e2e/option-4.jpg': squareJpeg('#8a6d3b'),
  '/tmp/hermes-e2e/option-5.jpg': squareJpeg('#3b5f8a')
}

Object.assign(window, {
  hermesDesktop: { readFileDataUrl: async (path: string) => images[path] ?? '' }
})

const text = [
  'Two more options:',
  '',
  '4. Samwise with a coil of Elven rope over his shoulder, dirt on his cheeks, a determined look.',
  '   MEDIA:/tmp/hermes-e2e/option-4.jpg',
  '5. Samwise at the garden gate at dawn, a pan hanging from his pack.',
  '   MEDIA:/tmp/hermes-e2e/option-5.jpg',
  '',
  'Tell me which one to use.'
].join('\n')

createRoot(document.getElementById('root')!).render(
  <div data-testid="message" style={{ width: 720, padding: 16 }}>
    <MessageTextContent text={text} />
  </div>
)
