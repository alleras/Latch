import type { LatchApi } from '../shared/types'

declare global {
  interface Window {
    latch: LatchApi
  }
}

export {}

