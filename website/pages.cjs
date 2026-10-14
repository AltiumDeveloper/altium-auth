// The site's pages: which Markdown files are published, under which URL, in which order, with which description.
// docusaurus.config.js (docs plugin `include` lists, sidebars, front matter), scripts/search-index.mjs and
// scripts/llms.mjs all read this list, so a page is added in one place.
//
// The sources stay plain GitHub-flavoured Markdown with no front matter: they render on GitHub and (the library
// READMEs) on npm, NuGet and PyPI. Titles come from each file's `# H1`; everything else Docusaurus needs is here and
// injected at build time (`frontMatter` → markdown.parseFrontMatter in docusaurus.config.js).
//
// URLs keep the shape of the former MkDocs site (/guides/overview/, /specification/spec/, /libraries/typescript/):
// the READMEs published to package registries link to them and cannot be changed after release.
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

// One entry per docs plugin instance. `dir` is relative to the repository root; `route` is the instance's
// routeBasePath. Page `file`s are relative to `dir`; `slug` overrides the URL Docusaurus derives from the file name.
const SECTIONS = [
  {
    id: 'default',
    kind: 'guide',
    label: 'Guides',
    dir: 'docs',
    route: '/',
    pages: [
      { file: 'index.md', label: 'Home', description: 'Client libraries and specification for Altium 365 authentication.' },
      { file: 'guides/overview.md', label: 'Overview', description: 'Endpoints, key terms, and the recommended authentication flow.' },
      { file: 'guides/web-and-server-apps.md', label: 'Web & server apps', description: 'The authorization-code redirect flow for confidential clients.' },
      { file: 'guides/desktop-apps.md', label: 'Desktop apps', description: 'Browser sign-in with PKCE over the ActionWait long-poll, for public clients.' },
      { file: 'guides/govcloud.md', label: 'GovCloud', description: 'Commercial vs Gov and the secure=1 two-token model.' },
      { file: 'guides/aes.md', label: 'AES (on-prem)', description: 'Customer-hosted installations of Altium Enterprise Server.' },
      { file: 'guides/token-claims.md', label: 'Access token claims', description: 'What is inside an access token: iss, workspaceId, secure, scopes.' },
      { file: 'guides/register-your-application.md', label: 'Register your application', description: 'Client types, redirect URLs, and credentials.' },
    ],
  },
  {
    id: 'spec',
    kind: 'spec',
    label: 'Specification',
    dir: 'spec',
    route: 'specification',
    pages: [
      { file: 'SPEC.md', slug: '/spec', label: 'Integration spec', description: 'The normative Altium delta over standard OAuth 2.0 / OIDC that every library implements.' },
      { file: 'conformance/README.md', label: 'Conformance vectors', description: 'The language-neutral vectors every library runs, and their matchers.' },
    ],
  },
  {
    id: 'libraries',
    kind: 'library',
    label: 'Libraries',
    dir: 'libs',
    route: 'libraries',
    pages: [
      { file: 'typescript/README.md', label: 'TypeScript', description: '@altium-developer/altium-auth on npm: installation, quick start, and API reference.' },
      { file: 'dotnet/README.md', label: '.NET', description: 'Altium.Auth on NuGet: installation, quick start, PowerShell use, and API reference.' },
      { file: 'python/README.md', label: 'Python', description: 'altium-auth on PyPI: installation, quick start, and API reference.' },
    ],
  },
];

// Docusaurus' doc id: the file path without its extension (README stays README).
const docId = (file) => file.replace(/\.mdx?$/, '');

// The page's URL path below the base URL, with the trailing slash the site uses (`trailingSlash: true`).
function pageRoute(section, page) {
  const base = section.route === '/' ? '' : `/${section.route}`;
  let tail;
  if (page.slug) tail = page.slug;
  else if (page.file === 'index.md') tail = '/';
  else tail = `/${docId(page.file).replace(/(^|\/)README$/, '')}`;
  return `${base}${tail}`.replace(/\/+$/, '') + '/';
}

// Every published page, in site order, with the absolute path of its source.
function allPages() {
  return SECTIONS.flatMap((section) => section.pages.map((page) => ({
    ...page,
    section: section.id,
    kind: section.kind,
    id: docId(page.file),
    source: path.join(REPO_ROOT, section.dir, page.file),
    repoPath: `${section.dir}/${page.file}`,
    route: pageRoute(section, page),
  })));
}

// Front matter injected into a source file at build time, or undefined for a file that is not a listed page.
function frontMatterFor(filePath) {
  const page = allPages().find((p) => p.source === path.resolve(filePath));
  if (!page) return undefined;
  const front = { sidebar_label: page.label, description: page.description };
  if (page.slug) front.slug = page.slug;
  return front;
}

module.exports = { REPO_ROOT, SECTIONS, docId, allPages, frontMatterFor };
