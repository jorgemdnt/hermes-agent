export interface CardReference {
  id: string
  board?: string
}

const CARD_ID = /^t_[0-9a-f]{8}$/

export function cardReference(value?: string): CardReference | null {
  if (!value) {return null}

  if (CARD_ID.test(value)) {return { id: value }}

  try {
    const url = new URL(value, 'https://hermes.invalid')

    if (!['http:', 'https:'].includes(url.protocol)) {return null}
    const match = /^\/m\/board\/(t_[0-9a-f]{8})\/?$/.exec(url.pathname)

    return match ? { id: match[1], ...(url.searchParams.get('board') ? { board: url.searchParams.get('board')! } : {}) } : null
  } catch {
    return null
  }
}

/** Only prose tokens: never rewrite an existing link, URL or code span. */
export function linkifyCardMentions(text: string): string {
  return text.replace(/(`+)[\s\S]*?\1|\[[^\]]*\]\([^)]+\)|https?:\/\/[^\s<>]+|\bt_[0-9a-f]{8}\b/g, value =>
    CARD_ID.test(value) ? `[${value}](/m/board/${value})` : value
  )
}

export function isWorkItemLink(value: string): boolean {
  try {
    const url = new URL(value)

    return ['http:', 'https:'].includes(url.protocol) && (
      url.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(url.pathname) ||
      url.hostname === 'linear.app' && /^\/[^/]+\/issue\//.test(url.pathname)
    )
  } catch {
    return false
  }
}

export interface CardSummary {
  id: string
  title: string
  status: string
  board?: string
}

/** Resolve on the selected board first, without changing the server selection. */
export async function resolveCard(
  reference: CardReference,
  selectedBoard: string,
  getTask: (id: string, board: string) => Promise<{ task: CardSummary }>,
  getBoards: () => Promise<{ boards: Array<{ slug: string }> }>
): Promise<CardSummary | null> {
  const first = reference.board ?? selectedBoard

  try {
    const { task } = await getTask(reference.id, first)

    return { ...task, board: first }
  } catch (error) {
    // Only a missing card warrants looking on other boards. Connectivity/auth
    // failures must not fan out into a request storm.
    if (!/404|not found/i.test(String(error))) {throw error}
  }

  if (reference.board) {return null}
  const { boards } = await getBoards()

  for (const { slug } of boards) {
    if (slug === first) {continue}

    try {
      const { task } = await getTask(reference.id, slug)

      return { ...task, board: slug }
    } catch (error) {
      if (!/404|not found/i.test(String(error))) {throw error}
    }
  }

  return null
}
