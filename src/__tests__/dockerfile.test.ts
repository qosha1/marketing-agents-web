import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8')
const installLines = dockerfile.split('\n').filter((l) => /pnpm install/.test(l) && !l.trim().startsWith('#'))

describe('Dockerfile installs from the committed lockfile', () => {
  it('uses --frozen-lockfile, never --no-frozen-lockfile', () => {
    expect(installLines.length).toBeGreaterThan(0)
    for (const l of installLines) {
      expect(l).toContain('--frozen-lockfile')
      expect(l).not.toContain('--no-frozen-lockfile')
    }
  })

  it('copies pnpm-lock.yaml before the install', () => {
    const copyIdx = dockerfile.search(/^COPY\s+package\.json\s+pnpm-lock\.yaml/m)
    const installIdx = dockerfile.search(/^RUN pnpm install/m)
    expect(copyIdx).toBeGreaterThanOrEqual(0)
    expect(copyIdx).toBeLessThan(installIdx)
  })
})
