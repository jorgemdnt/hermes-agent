export class NavigationHistory<T> {
  private entries: T[] = []
  private index = -1
  private key: (entry: T) => string
  private limit: number
  constructor(key: (entry: T) => string, limit = 120) { this.key = key; this.limit = limit }
  get current(): T | undefined { return this.entries[this.index] }
  get canGoBack(): boolean { return this.index > 0 }
  get canGoForward(): boolean { return this.index < this.entries.length - 1 }
  record(entry: T): void {
    if (this.current && this.key(this.current) === this.key(entry)) {
      this.update(entry)
      return
    }
    this.entries = [...this.entries.slice(0, this.index + 1), entry].slice(-this.limit)
    this.index = this.entries.length - 1
  }
  update(entry: T): void {
    if (this.index >= 0) this.entries[this.index] = entry
  }
  move(direction: -1 | 1): T | undefined {
    if (direction === -1 ? !this.canGoBack : !this.canGoForward) return undefined
    this.index += direction
    return this.current
  }
  clear(): void { this.entries = []; this.index = -1 }
}

export function historyKeyDirection(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): -1 | 1 | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return null
  if (event.key === '[' || event.code === 'BracketLeft') return -1
  if (event.key === ']' || event.code === 'BracketRight') return 1
  return null
}

/** The new destination mounts before release: don't let auxclick then walk
 * the host browser history or dismiss the card we just opened. */
export function bindHistoryMouseNavigation(target: Window, travel: (direction: -1 | 1) => void): () => void {
  const consume = (event: MouseEvent) => {
    if (event.button !== 3 && event.button !== 4) return false
    event.preventDefault()
    event.stopImmediatePropagation()
    return true
  }
  const down = (event: PointerEvent) => {
    if (consume(event)) travel(event.button === 3 ? -1 : 1)
  }
  const releaseEvents = ['pointerup', 'mouseup', 'auxclick'] as const
  target.addEventListener('pointerdown', down, true)
  for (const type of releaseEvents) target.addEventListener(type, consume, true)
  return () => {
    target.removeEventListener('pointerdown', down, true)
    for (const type of releaseEvents) target.removeEventListener(type, consume, true)
  }
}
