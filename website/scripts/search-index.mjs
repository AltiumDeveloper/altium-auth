#!/usr/bin/env node
// Writes static/search-index.json for src/theme/SearchBar (ranking: src/search/engine.mjs) from the pages listed in
// pages.cjs: one record per page and one per `##` / `###` section. Runs before `docusaurus build`; search:check then
// proves every record's URL and anchor exist in the built site.
//
// Record shape (short keys keep the index small): i id (= array index), n name (heading or page title), k kind (engine
// KINDS), u url (without baseUrl), d text, t page title (sections).
import { mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { pageSections, readPages } from './lib/markdown.mjs';

// Phrasings readers type for terms the pages spell differently: a query matching `match` also searches for `add`.
const SYNONYMS = [
  { match: '\\bgov\\b|government|itar', add: 'govcloud' },
  { match: 'on-?prem|enterprise server|self-?hosted', add: 'aes' },
  { match: 'desktop|native|cli\\b', add: 'actionwait' },
  { match: 'long-?poll|await\\b', add: 'actionwait' },
  { match: 'sign ?out|log ?out|logout', add: 'revoke' },
  { match: 'jwt|decode', add: 'claims' },
  { match: '\\bspa\\b|public client', add: 'pkce' },
  { match: 'secret|backend|server-side', add: 'confidential' },
  { match: 'workspace token|exchange', add: 'token exchange' },
];

export async function buildIndex() {
  const records = [];
  const push = (record) => records.push({ i: records.length, ...Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined && v !== '')) });
  for (const page of await readPages()) {
    for (const section of pageSections(page.text)) {
      if (!section.heading) {
        push({ n: page.title, k: page.kind, u: page.route, d: page.description ?? section.text });
        continue;
      }
      push({ n: section.heading, k: page.kind, u: `${page.route}#${section.anchor}`, t: page.title, d: section.text });
    }
  }
  return { version: 1, synonyms: SYNONYMS, records };
}

export async function runSearchIndex({ out = 'static/search-index.json' } = {}) {
  const payload = await buildIndex();
  const json = JSON.stringify(payload);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, json);
  return { records: payload.records.length, bytes: statSync(out).size, gzipBytes: gzipSync(json).length, payload };
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const { records, bytes, gzipBytes, payload } = await runSearchIndex();
  const byKind = {};
  for (const record of payload.records) byKind[record.k] = (byKind[record.k] ?? 0) + 1;
  console.log(`search-index: ${records} records, ${(bytes / 1024).toFixed(0)} KiB (${(gzipBytes / 1024).toFixed(0)} KiB gzip)`);
  console.log(`  ${Object.entries(byKind).map(([kind, count]) => `${kind} ${count}`).join(', ')}`);
}
