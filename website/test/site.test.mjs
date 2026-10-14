// Unit tests for the site scripts: page URLs (pages.cjs), Markdown helpers and search ranking. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { absoluteLinks, pageSections, pageTitle, readPages } from '../scripts/lib/markdown.mjs';
import { buildIndex } from '../scripts/search-index.mjs';
import { loadIndex, search } from '../src/search/engine.mjs';

const require = createRequire(import.meta.url);
const { SECTIONS, allPages } = require('../pages.cjs');

// The URLs of the former MkDocs site. Package READMEs on npm, NuGet and PyPI link to them, so they must not move.
const PUBLISHED_ROUTES = [
  '/',
  '/guides/overview/', '/guides/web-and-server-apps/', '/guides/desktop-apps/', '/guides/govcloud/', '/guides/aes/',
  '/guides/token-claims/', '/guides/register-your-application/',
  '/specification/spec/', '/specification/conformance/',
  '/libraries/typescript/', '/libraries/dotnet/', '/libraries/python/',
];

test('every page of the former site keeps its URL', () => {
  assert.deepEqual(allPages().map((page) => page.route).sort(), [...PUBLISHED_ROUTES].sort());
});

test('every sidebar section has its icon rule, and every category its subtitle', () => {
  const css = readFileSync(new URL('../src/css/custom.css', import.meta.url), 'utf8');
  for (const section of SECTIONS) {
    const rule = new RegExp(`\\.bc-${section.icon} \\{([^}]*)\\}`).exec(css)?.[1];
    assert.ok(rule?.includes('--bc-img') && rule.includes('--bc-bg'), `.bc-${section.icon} needs --bc-img and --bc-bg`);
    if (section.route) assert.ok(rule.includes('--section-path'), `.bc-${section.icon} needs --section-path`);
  }
});

test('pageSections: ## and ### sections with Docusaurus anchors, code left out', () => {
  const sections = pageSections([
    '# Title', 'Lead text.', '## Step 1 — Request authorization (with PKCE)', 'Body `code` here.',
    '```bash', 'curl secret', '```', '### Refresh & sign-out', '#### Deeper', 'More.', '## Step 1 — Request authorization (with PKCE)',
  ].join('\n'));
  assert.deepEqual(sections.map((s) => s.anchor), [null, 'step-1--request-authorization-with-pkce', 'refresh--sign-out', 'step-1--request-authorization-with-pkce-1']);
  assert.equal(sections[0].text, 'Lead text.');
  assert.ok(!sections[1].text.includes('curl'));
  assert.equal(sections[2].text, 'Deeper More.');
});

test('pageTitle: the first H1 outside code', () => {
  assert.equal(pageTitle('```\n# not this\n```\n# `Altium.Auth` client\n'), 'Altium.Auth client');
});

test('absoluteLinks: page links become Markdown-twin URLs, other links and code stay', async () => {
  const pages = await readPages();
  const overview = pages.find((p) => p.route === '/guides/overview/');
  const site = 'https://example.test/site';
  const text = [
    '[a](./desktop-apps.md#step-1) [b](#key-terms) [c](/libraries/python/) [d](https://x.test/y)',
    '<a href="#key-terms">e</a> `[f](./aes.md)`', '```', '[g](./aes.md)', '```',
  ].join('\n');
  assert.equal(absoluteLinks(text, overview, pages, site), [
    `[a](${site}/guides/desktop-apps.md#step-1) [b](${site}/guides/overview.md#key-terms) [c](${site}/libraries/python.md) [d](https://x.test/y)`,
    `<a href="${site}/guides/overview.md#key-terms">e</a> \`[f](./aes.md)\``, '```', '[g](./aes.md)', '```',
  ].join('\n'));
});

// Queries readers type, and a page whose record must rank in the top three.
const EXPECTED = [
  ['on-prem', 'AES (on-prem) considerations'],
  ['gov', 'GovCloud considerations'],
  ['token claims', 'Access token claims'],
  ['register', 'Register your application'],
  ['revoke', 'Authenticate a web or server application'],
  ['secure=1', 'Altium Identity Integration Specification'],
  ['powershell', 'Altium.Auth'],
  ['signIntoWorkspace', '@altium-developer/altium-auth'],
];

test('search: the expected page ranks in the top three', async () => {
  const { records, synonyms, index } = loadIndex(await buildIndex());
  for (const [query, page] of EXPECTED) {
    const top = search(index, records, query, { synonyms, limit: 3 }).map(({ record }) => record.t ?? record.n);
    assert.ok(top.includes(page), `"${query}" → ${JSON.stringify(top)}, expected ${page}`);
  }
});
