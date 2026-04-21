import path from 'node:path'
import { agentRepo, bootstrapAppDatabases } from '@mas/db'

const DB_PATH = path.resolve(process.cwd(), '..', '..', 'data.db')
const MEMORY_DB_PATH = path.resolve(process.cwd(), '..', '..', 'storage', 'memory', 'memory.db')

let initialized = false

export function initDb() {
  if (initialized) return
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
