const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000

interface SessionEntry<T> {
  key: string
  connectionId: string
  resource: Promise<T>
  activeTasks: number
  closeRequested: boolean
  idleTimer?: NodeJS.Timeout
  disposePromise?: Promise<void>
  idleWaiters: Array<() => void>
}

type ResourceFactory<T> = () => T | Promise<T>
type ResourceDisposer<T> = (resource: T) => void | Promise<void>

export class DatabaseSessionCache<T> {
  private readonly entries = new Map<string, SessionEntry<T>>()

  constructor(
    private readonly disposeResource: ResourceDisposer<T>,
    private readonly idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS
  ) {}

  async run<R>(
    connectionId: string,
    database: string,
    createResource: ResourceFactory<T>,
    task: (resource: T) => R | Promise<R>
  ): Promise<R> {
    const entry = this.getOrCreate(connectionId, database, createResource)
    this.clearIdleTimer(entry)
    entry.activeTasks += 1

    try {
      return await task(await entry.resource)
    } finally {
      entry.activeTasks -= 1
      if (entry.activeTasks === 0) {
        entry.idleWaiters.splice(0).forEach((resolve) => resolve())
        if (!entry.closeRequested && this.entries.get(entry.key) === entry) this.scheduleIdleClose(entry)
      }
    }
  }

  async close(connectionId: string, database: string): Promise<void> {
    const entry = this.entries.get(this.key(connectionId, database))
    if (entry) await this.requestClose(entry)
  }

  async closeConnection(connectionId: string): Promise<void> {
    const entries = [...this.entries.values()].filter((entry) => entry.connectionId === connectionId)
    await Promise.all(entries.map((entry) => this.requestClose(entry)))
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.entries.values()].map((entry) => this.requestClose(entry)))
  }

  private getOrCreate(connectionId: string, database: string, createResource: ResourceFactory<T>): SessionEntry<T> {
    const key = this.key(connectionId, database)
    const existing = this.entries.get(key)
    if (existing) return existing

    const entry: SessionEntry<T> = {
      key,
      connectionId,
      resource: Promise.resolve().then(createResource),
      activeTasks: 0,
      closeRequested: false,
      idleWaiters: []
    }
    this.entries.set(key, entry)
    void entry.resource.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key)
    })
    return entry
  }

  private async requestClose(entry: SessionEntry<T>): Promise<void> {
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key)
    entry.closeRequested = true
    this.clearIdleTimer(entry)

    if (entry.activeTasks > 0) {
      await new Promise<void>((resolve) => entry.idleWaiters.push(resolve))
    }
    await this.dispose(entry)
  }

  private dispose(entry: SessionEntry<T>): Promise<void> {
    if (!entry.disposePromise) {
      entry.disposePromise = entry.resource.then(this.disposeResource, () => undefined)
    }
    return entry.disposePromise
  }

  private scheduleIdleClose(entry: SessionEntry<T>): void {
    this.clearIdleTimer(entry)
    entry.idleTimer = setTimeout(() => {
      void this.requestClose(entry).catch((error: unknown) => {
        console.error('Failed to close an idle database session.', error)
      })
    }, this.idleTimeoutMs)
    entry.idleTimer.unref()
  }

  private clearIdleTimer(entry: SessionEntry<T>): void {
    if (!entry.idleTimer) return
    clearTimeout(entry.idleTimer)
    entry.idleTimer = undefined
  }

  private key(connectionId: string, database: string): string {
    return JSON.stringify([connectionId, database])
  }
}
