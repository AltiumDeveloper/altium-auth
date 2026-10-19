#!/usr/bin/env node
// Runs after `npm run llms`: checks the LLM surface in build/ (every .md twin, llms.txt, llms-full.txt). Fails on
// MDX/JSX or Docusaurus leftovers, relative or .mdx links, and internal absolute links that do not resolve to a file
// in build/.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteUrlFromConfig } from './llms.mjs';

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/;
const JSX_ELEMENT = /<([A-Z][A-Za-z0-9]*)(?=[\s/>])/g;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const INDEX_FILE = /^llms.*\.txt$/;
const MAX_REPORTED = 50;

// Text without fenced code blocks and inline code spans (their content is literal, not Markdown).
export function stripCode(text) {
  return text.replace(/^(```+|~~~+)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '').replace(/`+[^`\n]*`+/g, '');
}

// Leftovers that must not reach the Markdown surface.
export function contentProblems(text) {
  const prose = stripCode(text);
  const problems = [...new Set([...prose.matchAll(JSX_ELEMENT)].map((match) => match[1]))].map((name) => `JSX element <${name}`);
  if (/^\s*export\s+const\b/m.test(prose)) problems.push('`export const`');
  if (ZERO_WIDTH.test(text)) problems.push('zero-width character');
  if (prose.includes('hash-link')) problems.push('`hash-link`');
  if (prose.includes('Direct link to')) problems.push('"Direct link to"');
  return problems;
}

// Link targets of Markdown links and images (`[x](url)`, `[x](<url>)`), HTML hrefs, then autolinks, outside code.
export function extractLinks(text) {
  const prose = stripCode(text);
  const inline = [...prose.matchAll(/\]\((?:<([^>\s]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g)].map((match) => match[1] ?? match[2]);
  const hrefs = [...prose.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  const auto = [...prose.matchAll(/(?<!\]\()<((?:https?|mailto):[^>\s]+)>/g)].map((match) => match[1]);
  return [...inline, ...hrefs, ...auto];
}

// Path under build/ of an internal absolute URL (fragment and query removed; '' for the site root), else null.
export function internalPath(url, siteUrl) {
  const base = siteUrl.replace(/\/+$/, '');
  if (url !== base && !url.startsWith(`${base}/`)) return null;
  return decodeURIComponent(url.slice(base.length).replace(/[?#].*$/, '').replace(/^\/+/, ''));
}

// Problem with one link, or null. `exists(path)` tells whether a build/-relative path is a file.
export function linkProblem(url, { siteUrl, exists }) {
  if (!SCHEME.test(url)) return `relative link ${url}`;
  if (/\.mdx(?:[?#]|$)/i.test(url)) return `.mdx link ${url}`;
  const path = internalPath(url, siteUrl);
  if (path === null) return null;
  const candidates = path === '' || path.endsWith('/') ? [`${path}index.html`] : [path, `${path}/index.html`];
  return candidates.some(exists) ? null : `broken internal link ${url}`;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

// Returns { files, links, problems: [{ file, message }] }; `links` counts distinct link targets checked.
export function runCheck({ buildDir = 'build', siteUrl = siteUrlFromConfig() } = {}) {
  if (!existsSync(buildDir)) throw new Error(`llms:check: ${buildDir} not found; run npm run build first`);
  const problems = [];
  const report = (file, message) => problems.push({ file, message });
  const all = walk(buildDir).map((path) => relative(buildDir, path).split(sep).join('/'));
  const texts = all.filter((path) => path.endsWith('.md') || INDEX_FILE.test(path.split('/').pop()));
  if (!texts.some((path) => path === 'llms.txt')) report('llms.txt', 'missing; run npm run llms');

  const fileCache = new Map();
  const exists = (path) => {
    if (!fileCache.has(path)) {
      const full = join(buildDir, path);
      fileCache.set(path, existsSync(full) && statSync(full).isFile());
    }
    return fileCache.get(path);
  };
  const linkCache = new Map();
  for (const file of texts) {
    const text = readFileSync(join(buildDir, file), 'utf8');
    for (const message of contentProblems(text)) report(file, message);
    for (const url of new Set(extractLinks(text))) {
      if (!linkCache.has(url)) linkCache.set(url, linkProblem(url, { siteUrl, exists }));
      const problem = linkCache.get(url);
      if (problem) report(file, problem);
    }
  }
  return { files: texts.length, links: linkCache.size, problems };
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const { files, links, problems } = runCheck();
  for (const { file, message } of problems.slice(0, MAX_REPORTED)) console.error(`llms:check: ${file}: ${message}`);
  if (problems.length > MAX_REPORTED) console.error(`llms:check: … and ${problems.length - MAX_REPORTED} more`);
  console.log(`llms:check: ${files} files, ${links} distinct links checked, ${problems.length} problem(s)`);
  if (problems.length) process.exit(1);
}
