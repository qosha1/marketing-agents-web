#!/usr/bin/env node
// LOCAL-STACK ONLY stand-in for the n8n writer webhook. It never talks to the live
// OGMC writer and never leaves this laptop: it answers the relay (/actions/generate-drafts)
// with 200 and, a few seconds later, writes one `draft` back to the LOCAL tenant,
// stamped with the topic_ref the relay sent, exactly as the real writer does.
//
//   node local-stack/stub-writer.mjs            # reads local-stack/stack.env
//   N8N_WRITER_WEBHOOK_URL=http://127.0.0.1:$STUB_WRITER_PORT/ ./local-stack/up.sh
//
// Env: STUB_WRITER_PORT (default 4399), STUB_WRITER_DELAY_MS (default 3000),
// STUB_WRITER_TENANT_URL / STUB_WRITER_DEVAUTH_URL (default: ports from stack.env).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, 'stack.env'), 'utf8')
    .split('\n')
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^"|"$/g, '')]),
);
const PORT = Number(process.env.STUB_WRITER_PORT || 4399);
const DELAY = Number(process.env.STUB_WRITER_DELAY_MS || 3000);
const TENANT = process.env.STUB_WRITER_TENANT_URL || `http://127.0.0.1:${env.STACK_PORT_TENANT}`;
const DEVAUTH = process.env.STUB_WRITER_DEVAUTH_URL || `http://127.0.0.1:${env.STACK_PORT_DEVAUTH}`;
const login = JSON.parse(readFileSync(join(here, 'devauth.json'), 'utf8')).users[0];

async function writeDraft(story) {
  const tok = await fetch(`${DEVAUTH}/api/v1/auth/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: login.email, password: login.password, app: env.STACK_SLUG }),
  }).then((r) => r.json());
  const title = String(story.title || story.topic_title || 'Untitled');
  const data = {
    status: 'ready_for_review',
    lang: 'en',
    content_type: story.content_type || 'general',
    candidate_index: 0,
    chosen: false,
    blog: `# ${title}\n\nStub-writer body for "${title}". ${story.context || ''}\n\nSources:\n${story.sources || ''}`,
    linkedin: `Stub-writer LinkedIn post for "${title}".`,
    seo: { title, meta: `Stub-writer description for ${title}.` },
    topic_ref: String(story.topic_ref),
    _trigger: story.trigger,
    ...(story.triggered_by ? { _triggered_by: story.triggered_by } : {}),
    ...(story.scope_path ? { scope_path: story.scope_path } : {}),
  };
  const res = await fetch(`${TENANT}/api/v1/entities/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok.access}` },
    body: JSON.stringify({ entity_type: 'draft', name: `Draft: ${title}`, data }),
  });
  console.log('[stub-writer] draft for topic', story.topic_ref, '->', res.status, (await res.text()).slice(0, 160));
}

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    try {
      const story = JSON.parse(body);
      console.log('[stub-writer] relay received for topic', story.topic_ref);
      setTimeout(() => writeDraft(story).catch((e) => console.error('[stub-writer] failed', e)), DELAY);
    } catch (e) {
      console.error('[stub-writer] bad body', e);
    }
  });
}).listen(PORT, '127.0.0.1', () => console.log(`[stub-writer] listening on 127.0.0.1:${PORT} (local tenant ${TENANT})`));
