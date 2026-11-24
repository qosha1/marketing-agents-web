import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The seeder validates a file's {{id:type:external_id}} references against rows
// that already landed, so a reference to a row in the SAME file rejects the whole
// file. Every reference must name a row defined in an EARLIER fixture file.
const root = process.cwd()
const env = readFileSync(join(root, 'local-stack/stack.env'), 'utf8')
const files = /^STACK_FIXTURES="([^"]+)"/m.exec(env)![1].split(/\s+/)

describe('local-stack fixtures', () => {
  it('only reference rows from earlier files', () => {
    const seen = new Set<string>()
    for (const f of files) {
      const text = readFileSync(join(root, f), 'utf8')
      const rows = JSON.parse(text).rows as { entity_type: string; external_id: string }[]
      const refs = [...text.matchAll(/\{\{id:([a-z_]+):([^}]+)\}\}/g)]
        .map((m) => `${m[1]}:${m[2]}`)
        .filter((r) => !r.endsWith(':...'))
      for (const r of refs) expect(seen.has(r), `${f} references ${r} before it exists`).toBe(true)
      for (const row of rows) seen.add(`${row.entity_type}:${row.external_id}`)
    }
  })
})
