import { expose } from 'comlink'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CancelledError, createWorkerJob, SupersededError, type Terminable } from './spawn'

const api = {
  echo: (s: string) => s.toUpperCase(),
  /** Stands in for a regex that backtracks forever. */
  hang: () => new Promise<never>(() => {}),
  fail: () => {
    throw new Error('bad regex')
  },
}
type Api = typeof api

/** A MessageChannel posing as a Worker, recording spawns and terminations. */
function harness() {
  const ports: MessagePort[] = []
  const terminated: number[] = []
  let spawned = 0
  const spawn = (): Terminable => {
    const id = spawned++
    const { port1, port2 } = new MessageChannel()
    expose(api, port2)
    ports.push(port1, port2)
    return Object.assign(port1, {
      terminate: () => {
        terminated.push(id)
        port1.close()
        port2.close()
      },
    })
  }
  return {
    spawn,
    terminated,
    spawned: () => spawned,
    close: () => ports.forEach((p) => p.close()),
  }
}

describe('createWorkerJob', () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
  })
  afterEach(() => {
    vi.useRealTimers()
    h.close()
  })

  it('round-trips a result', async () => {
    const job = createWorkerJob<Api>(h.spawn)
    await expect(job.run((a) => a.echo('hi'))).resolves.toBe('HI')
  })

  it('propagates an error thrown in the worker without killing it', async () => {
    const job = createWorkerJob<Api>(h.spawn)
    await expect(job.run((a) => a.fail())).rejects.toThrow('bad regex')
    expect(h.terminated).toEqual([])
    await expect(job.run((a) => a.echo('ok'))).resolves.toBe('OK')
    expect(h.spawned()).toBe(1)
  })

  it('reuses an idle worker rather than respawning', async () => {
    const job = createWorkerJob<Api>(h.spawn)
    await job.run((a) => a.echo('a'))
    await job.run((a) => a.echo('b'))
    expect(h.spawned()).toBe(1)
    expect(h.terminated).toEqual([])
  })

  it('supersedes a busy run: rejects it, terminates its worker, runs the new one', async () => {
    const job = createWorkerJob<Api>(h.spawn)
    const stuck = job.run((a) => a.hang())
    const next = job.run((a) => a.echo('next'))
    await expect(stuck).rejects.toBeInstanceOf(SupersededError)
    await expect(next).resolves.toBe('NEXT')
    expect(h.terminated).toEqual([0])
    expect(h.spawned()).toBe(2)
  })

  it('reports slowness at slowMs, not before', () => {
    vi.useFakeTimers()
    const job = createWorkerJob<Api>(h.spawn, { slowMs: 2000 })
    const onSlow = vi.fn()
    job.run((a) => a.hang(), { onSlow }).catch(() => {})
    vi.advanceTimersByTime(1999)
    expect(onSlow).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onSlow).toHaveBeenCalledOnce()
    // Slowness alone never kills the worker; only the user does.
    expect(h.terminated).toEqual([])
    job.dispose()
  })

  it('does not report a run that finished in time', async () => {
    vi.useFakeTimers()
    const job = createWorkerJob<Api>(h.spawn, { slowMs: 2000 })
    const onSlow = vi.fn()
    await job.run((a) => a.echo('fast'), { onSlow })
    vi.advanceTimersByTime(5000)
    expect(onSlow).not.toHaveBeenCalled()
  })

  it('cancel terminates the worker and rejects with CancelledError', async () => {
    const job = createWorkerJob<Api>(h.spawn)
    const stuck = job.run((a) => a.hang())
    job.cancel()
    await expect(stuck).rejects.toBeInstanceOf(CancelledError)
    expect(h.terminated).toEqual([0])
  })

  it('respawns after a cancel', async () => {
    const job = createWorkerJob<Api>(h.spawn)
    const stuck = job.run((a) => a.hang())
    job.cancel()
    await stuck.catch(() => {})
    await expect(job.run((a) => a.echo('again'))).resolves.toBe('AGAIN')
    expect(h.spawned()).toBe(2)
  })

  it('cancel with nothing in flight keeps the warm worker', async () => {
    const job = createWorkerJob<Api>(h.spawn)
    await job.run((a) => a.echo('a'))
    job.cancel()
    expect(h.terminated).toEqual([])
  })

  it('dispose kills an idle worker but leaves the job usable', async () => {
    const job = createWorkerJob<Api>(h.spawn)
    await job.run((a) => a.echo('a'))
    job.dispose()
    expect(h.terminated).toEqual([0])
    await expect(job.run((a) => a.echo('b'))).resolves.toBe('B')
  })
})
