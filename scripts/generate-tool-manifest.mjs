import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const toolsDir = join(repoRoot, 'packages/core/src/tools')
const outputPath = join(toolsDir, 'generated.ts')

const ignoredFiles = new Set([
  'generated.ts',
  'index.ts',
  'registry.ts',
  'types.ts',
])

function getToolExports(filePath) {
  const source = readFileSync(filePath, 'utf8')
  const matches = source.matchAll(/export const (\w+)\s*:\s*Tool\s*=/g)
  return Array.from(matches, ([, exportName]) => exportName)
}

const toolModules = readdirSync(toolsDir)
  .filter((fileName) => fileName.endsWith('.ts'))
  .filter((fileName) => !fileName.endsWith('.test.ts'))
  .filter((fileName) => !ignoredFiles.has(fileName))
  .map((fileName) => ({
    fileName,
    exportNames: getToolExports(join(toolsDir, fileName)),
  }))
  .filter((module) => module.exportNames.length > 0)
  .sort((a, b) => a.fileName.localeCompare(b.fileName))

const importLines = toolModules.map(
  ({ fileName, exportNames }) =>
    `import { ${exportNames.join(', ')} } from './${fileName.slice(0, -3)}'`,
)

const toolNames = toolModules.flatMap((module) => module.exportNames)

const nextSource = `import type { Tool } from './types'
${importLines.join('\n')}

export const defaultTools: Tool[] = [
  ${toolNames.join(',\n  ')},
]
`

const previousSource = (() => {
  try {
    return readFileSync(outputPath, 'utf8')
  } catch {
    return null
  }
})()

if (previousSource !== nextSource) {
  writeFileSync(outputPath, nextSource, 'utf8')
}
