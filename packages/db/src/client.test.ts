import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, migrateLegacyAppDb, resetDb, resolveDefaultAppDbPath } from './client'

test('getDb defaults to storage/app/data.db under the current working directory', { concurrency: false }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-app-db-path-'))
  const originalCwd = process.cwd()
  const originalAppDbPath = process.env.MAS_APP_DB_PATH

  try {
    delete process.env.MAS_APP_DB_PATH
    process.chdir(dir)
    resetDb()

    getDb()

    assert.equal(resolveDefaultAppDbPath(), join(dir, 'storage', 'app', 'data.db'))
    assert.equal(existsSync(join(dir, 'storage', 'app', 'data.db')), true)
    assert.equal(existsSync(join(dir, 'data.db')), false)
  } finally {
    resetDb()
    process.chdir(originalCwd)
    if (originalAppDbPath === undefined) {
      delete process.env.MAS_APP_DB_PATH
    } else {
      process.env.MAS_APP_DB_PATH = originalAppDbPath
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

test('migrateLegacyAppDb moves root data.db sidecars into storage/app when target is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-app-db-migrate-'))

  try {
    writeFileSync(join(dir, 'data.db'), 'legacy-db')
    writeFileSync(join(dir, 'data.db-wal'), 'legacy-wal')
    writeFileSync(join(dir, 'data.db-shm'), 'legacy-shm')

    const migrated = migrateLegacyAppDb({
      legacyPath: join(dir, 'data.db'),
      targetPath: join(dir, 'storage', 'app', 'data.db'),
    })

    assert.equal(migrated, true)
    assert.equal(existsSync(join(dir, 'data.db')), false)
    assert.equal(existsSync(join(dir, 'data.db-wal')), false)
    assert.equal(existsSync(join(dir, 'data.db-shm')), false)
    assert.equal(existsSync(join(dir, 'storage', 'app', 'data.db')), true)
    assert.equal(existsSync(join(dir, 'storage', 'app', 'data.db-wal')), true)
    assert.equal(existsSync(join(dir, 'storage', 'app', 'data.db-shm')), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
