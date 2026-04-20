import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { acquireProcessLock } from './lock'

test('acquireProcessLock rejects a second live owner until the first releases', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-daemon-lock-'))
  const lockPath = join(dir, 'daemon.lock')

  try {
    const first = await acquireProcessLock({
      lockPath,
      pid: 4101,
      metadata: { owner: 'first' },
      isProcessAlive: (pid) => pid === 4101,
    })

    await assert.rejects(
      () => acquireProcessLock({
        lockPath,
        pid: 4102,
        metadata: { owner: 'second' },
        isProcessAlive: (pid) => pid === 4101,
      }),
      /already running/i,
    )

    await first.release()

    const second = await acquireProcessLock({
      lockPath,
      pid: 4103,
      metadata: { owner: 'second' },
      isProcessAlive: () => true,
    })
    await second.release()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
