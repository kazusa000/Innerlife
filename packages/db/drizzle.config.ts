import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  dbCredentials: {
    // Resolved relative to packages/db cwd → project root.
    url: '../../data.db',
  },
})
