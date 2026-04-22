import assert from 'node:assert/strict'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { ManagedLtpSidecar, isManagedLtpBaseUrl } from './ltp-sidecar'

test('isManagedLtpBaseUrl only accepts local loopback urls', () => {
  assert.equal(isManagedLtpBaseUrl(undefined), false)
  assert.equal(isManagedLtpBaseUrl(''), false)
  assert.equal(isManagedLtpBaseUrl('http://127.0.0.1:7788'), true)
  assert.equal(isManagedLtpBaseUrl('http://localhost:7788'), true)
  assert.equal(isManagedLtpBaseUrl('http://192.168.1.10:7788'), false)
  assert.equal(isManagedLtpBaseUrl('https://127.0.0.1:7788'), false)
})

test('ManagedLtpSidecar starts and stops a local sidecar process', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-ltp-sidecar-'))
  const port = 7798
  const scriptPath = join(dir, 'fake-ltp.js')
  writeFileSync(
    scriptPath,
    `
      const http = require('node:http');
      const port = ${port};
      const server = http.createServer((req, res) => {
        if (req.url === '/health') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
      server.listen(port, '127.0.0.1');
      const shutdown = () => server.close(() => process.exit(0));
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    `,
  )

  const sidecar = new ManagedLtpSidecar({
    baseUrl: `http://127.0.0.1:${port}`,
    command: [process.execPath, scriptPath],
  })

  try {
    await sidecar.start()
    const response = await fetch(`http://127.0.0.1:${port}/health`)
    assert.equal(response.status, 200)
  } finally {
    await sidecar.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ManagedLtpSidecar is a no-op for non-local urls', async () => {
  const sidecar = new ManagedLtpSidecar({
    baseUrl: 'http://192.168.1.10:7788',
    command: [process.execPath, '-e', 'process.exit(1)'],
  })

  await sidecar.start()
  await sidecar.stop()
})
