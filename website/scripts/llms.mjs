#!/usr/bin/env node
// Runs after `docusaurus build`: writes the site's Markdown surface for AI assistants into build/ (https://llmstxt.org).
//   <route>.md     a Markdown twin of every page (/guides/overview/ → /guides/overview.md, the home page → /index.md),
//                  from its source with links made absolute; src/theme links each page to its twin
//   llms.txt       the index: every page, by section, with its description (pages.cjs)
//   llms-full.txt  every twin, concatenated in site order
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absoluteLinks, readPages } from './lib/markdown.mjs';

const require = createRequire(import.meta.url);
const { SECTIONS } = require('../pages.cjs');

export function siteUrlFromConfig() {
  const { url, baseUrl } = require('../docusaurus.config.js');
  return `${url}${baseUrl}`.replace(/\/+$/, '');
}

const twinPath = (route) => (route === '/' ? 'index.md' : `${route.replace(/^\/|\/$/g, '')}.md`);

export function renderIndex(pages, siteUrl) {
  const { title, tagline } = require('../docusaurus.config.js');
  const lines = [
    `# ${title}`,
    '',
    `> ${tagline}. Covers the Altium-specific parts of the flow: the ActionWait desktop sign-in, workspace token exchange, GovCloud (\`secure=1\`) and AES (on-prem) installations, refresh and revocation.`,
    '',
    'The integration specification is normative; the guides explain the flows; each library page is its package README.',
  ];
  for (const section of SECTIONS) {
    lines.push('', `## ${section.label}`, '');
    for (const page of pages.filter((p) => p.section === section.id)) {
      lines.push(`- [${page.title}](${siteUrl}/${twinPath(page.route)}): ${page.description}`);
    }
  }
  lines.push('', '## Optional', '', `- [Everything on one page](${siteUrl}/llms-full.txt): all pages above, concatenated`);
  return `${lines.join('\n')}\n`;
}

export async function runLlms({ buildDir = 'build', siteUrl = siteUrlFromConfig() } = {}) {
  const pages = await readPages();
  const twins = pages.map((page) => ({ page, markdown: `${absoluteLinks(page.text, page, pages, siteUrl).trimEnd()}\n` }));
  for (const { page, markdown } of twins) {
    const out = join(buildDir, twinPath(page.route));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, markdown);
  }
  writeFileSync(join(buildDir, 'llms.txt'), renderIndex(pages, siteUrl));
  const full = twins.map(({ page, markdown }) => `<!-- ${siteUrl}${page.route} -->\n\n${markdown}`).join('\n---\n\n');
  writeFileSync(join(buildDir, 'llms-full.txt'), full);
  return { pages: twins.length };
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const { pages } = await runLlms();
  console.log(`llms: ${pages} Markdown pages, llms.txt, llms-full.txt`);
}
