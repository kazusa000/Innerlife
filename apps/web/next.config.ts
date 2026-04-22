import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  transpilePackages: ['@mas/core', '@mas/db', '@mas/turing'],
}

export default nextConfig
