/**
 * A tiny concurrency limiter (p-limit style). Caps how many async tasks run at
 * once; the rest queue and start as slots free up.
 *
 * Used by the route snapper so a shape with many waypoints doesn't fire dozens
 * of simultaneous requests at the public routing server (which rate-limits and
 * drops them — the reason "follow roads" only snapped some points). With a small
 * cap, every segment gets snapped reliably, just in waves.
 */

export interface Limiter {
  /** Queue `task`; it runs when a slot is free. Resolves/rejects with its result. */
  run<T>(task: () => Promise<T>): Promise<T>
  /** Currently running. */
  readonly active: number
  /** Waiting for a slot. */
  readonly pending: number
}

export function createLimiter(maxConcurrent: number): Limiter {
  const max = Math.max(1, Math.floor(maxConcurrent))
  let active = 0
  const queue: Array<() => void> = []

  const pump = () => {
    while (active < max && queue.length > 0) {
      const start = queue.shift()!
      active += 1
      start()
    }
  }

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push(() => {
          // `Promise.resolve().then(task)` turns a synchronous throw in `task`
          // into a rejection, so the slot is always freed (no leak / stall).
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              active -= 1
              pump()
            })
        })
        pump()
      })
    },
    get active() {
      return active
    },
    get pending() {
      return queue.length
    },
  }
}
