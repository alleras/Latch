/**
 * Decides whether a tab activation may adopt the explorer's connection.
 *
 * Only activations the user caused (clicking a tab, or closing the active tab) may adopt. The app
 * activates tabs on its own too: restoring the workspace at launch, closing tabs when a connection
 * is removed, dropping a file tab that could not be reloaded. Those activations are suppressed, one
 * at a time: suppress the id about to become active, and the next activation check for that id
 * answers "no" exactly once. Any activation of a different tab clears a stale suppression.
 */
export interface ActivationGuard {
  suppress: (tabId: string) => void
  shouldAdopt: (tabId: string | null) => boolean
}

export function createActivationGuard(): ActivationGuard {
  let suppressed: string | null = null
  return {
    suppress(tabId) {
      suppressed = tabId
    },
    shouldAdopt(tabId) {
      const skip = tabId !== null && suppressed === tabId
      suppressed = null
      return tabId !== null && !skip
    }
  }
}
