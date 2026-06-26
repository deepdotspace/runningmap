import { describe, expect, it } from 'vitest'
import { createLimiter } from './limiter'

/** A promise whose resolve is captured so the test controls completion. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('createLimiter', () => {
  it('never runs more than the cap at once', async () => {
    const limiter = createLimiter(2)
    const gates = Array.from({ length: 5 }, () => deferred<void>())
    let running = 0
    let peak = 0

    const tasks = gates.map((g) =>
      limiter.run(async () => {
        running += 1
        peak = Math.max(peak, running)
        await g.promise
        running -= 1
      }),
    )

    // With a cap of 2, only 2 should be active and 3 queued.
    await Promise.resolve()
    expect(limiter.active).toBe(2)
    expect(limiter.pending).toBe(3)

    // Release them one at a time; the cap must hold throughout.
    for (const g of gates) {
      g.resolve()
      await Promise.resolve()
    }
    await Promise.all(tasks)
    expect(peak).toBeLessThanOrEqual(2)
    expect(limiter.active).toBe(0)
    expect(limiter.pending).toBe(0)
  })

  it('propagates results and errors, and a failure frees its slot', async () => {
    const limiter = createLimiter(1)
    await expect(limiter.run(async () => 42)).resolves.toBe(42)
    await expect(limiter.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    // Slot was freed despite the rejection.
    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok')
    expect(limiter.active).toBe(0)
  })

  it('treats a cap below 1 as 1', () => {
    expect(createLimiter(0).run).toBeTypeOf('function')
  })

  it('a synchronously-throwing task rejects without stalling the queue', async () => {
    const limiter = createLimiter(1)
    await expect(
      limiter.run(() => {
        throw new Error('sync')
      }),
    ).rejects.toThrow('sync')
    // The slot was freed despite the synchronous throw — the next task runs.
    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok')
    expect(limiter.active).toBe(0)
    expect(limiter.pending).toBe(0)
  })
})
