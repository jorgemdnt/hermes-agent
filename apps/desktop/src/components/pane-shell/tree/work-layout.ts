import { allPaneIds, type LayoutNode } from './model'

/** Bundled Codex-style layout: sessions | chat-over-terminal | work. */
export const WORK_LAYOUT_ID = 'work'

/** True when the tree is the Work arrangement (not stock Default with files). */
export function treeLooksLikeWork(tree: LayoutNode | null | undefined): boolean {
  if (!tree) {
    return false
  }

  const ids = allPaneIds(tree)

  return ids.includes('work') && ids.includes('workspace') && ids.includes('terminal') && !ids.includes('files')
}
