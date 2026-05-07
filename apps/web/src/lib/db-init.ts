import path from 'node:path'
import { agentRepo, bootstrapAppDatabases, migrateLegacyAppDb } from '@mas/db'

const REPO_ROOT = path.resolve(process.cwd(), '..', '..')
const DB_PATH = path.resolve(REPO_ROOT, 'storage', 'app', 'data.db')
const LEGACY_DB_PATH = path.resolve(REPO_ROOT, 'data.db')
const MEMORY_DB_PATH = path.resolve(REPO_ROOT, 'storage', 'memory', 'memory.db')

let initialized = false

export function initDb() {
  if (initialized) return
  migrateLegacyAppDb({
    legacyPath: LEGACY_DB_PATH,
    targetPath: DB_PATH,
  })
  bootstrapAppDatabases({
    dbPath: DB_PATH,
    memoryDbPath: MEMORY_DB_PATH,
  })
  initialized = true
}

export function getDefaultAgent() {
  initDb()
  let agent = agentRepo.listAgents()[0]
  if (!agent) {
    agent = agentRepo.createAgent({
      name: 'Default Agent',
      description: 'A helpful AI assistant that can execute bash commands.',
      model: 'claude-sonnet-4-6',
    })!
  }
  return agent
}
