import { useCallback, useEffect, useState } from 'react'
import type { CliInstallStatus } from '../../../../shared/types'
import { readableErrorMessage } from '../../errors'

/** Installation state of the `latch` command, refreshed whenever the settings view opens. */
export function useCliInstall(active: boolean) {
  const [status, setStatus] = useState<CliInstallStatus | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setError(null)
    void window.latch.getCliInstallStatus()
      .then((next) => { if (!cancelled) setStatus(next) })
      .catch((reason: unknown) => { if (!cancelled) setError(readableErrorMessage(reason)) })
    return () => { cancelled = true }
  }, [active])

  const install = useCallback(async (): Promise<void> => {
    setInstalling(true)
    setError(null)
    try {
      setStatus(await window.latch.installCli())
    } catch (reason) {
      setError(readableErrorMessage(reason))
    } finally {
      setInstalling(false)
    }
  }, [])

  return { status, installing, error, install }
}
