// The site's pages: which Markdown files are published, under which URL, in which sidebar section and order, with
// which description. docusaurus.config.js (docs plugin `include`, sidebar, front matter), scripts/search-index.mjs and
// scripts/llms.mjs all read this list, so a page is added in one place.
//
// The sources stay plain GitHub-flavoured Markdown with no front matter: they render on GitHub and (the library
// READMEs) on npm, NuGet and PyPI. Titles come from each file's `# H1`; everything else Docusaurus needs is here and
// injected at build time (`frontMatterFor` → markdown.parseFrontMatter in docusaurus.config.js).
//
// URLs keep the shape of the former MkDocs site (/guides/overview/, /specification/spec/, /libraries/typescript/):
// the READMEs published to package registries link to them and cannot be changed after release.
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

// The sidebar sections, in sidebar order, like the namespaces of the Altium Designer SDK reference: each has a
// coloured icon and its source directory as a subtitle (`icon` → `.bc-<icon>` in src/css/custom.css, which sets
// `--bc-img`, `--bc-bg` and `--section-path`). `route` is the section's landing page (a generated index of its pages),
// `kind` the search kind (src/search/engine.mjs KINDS).
// Page `file`s are repository-relative; `route` is the page URL below the base URL.
const SECTIONS = [
  {
    id: 'home',
    label: 'Home',
    kind: 'guide',
    icon: 'home',
    pages: [
      { file: 'docs/index.md', route: '/', label: 'Home', description: 'Client libraries and specification for Altium 365 authentication.' },
    ],
  },
  {
    id: 'guides',
    label: 'Guides',
    kind: 'guide',
    icon: 'guides',
    route: '/guides/',
    description: 'The authentication flows, protocol-level and independent of any library.',
    pages: [
      { file: 'docs/guides/overview.md', route: '/guides/overview/', label: 'Overview', description: 'Endpoints, key terms, and the recommended authentication flow.' },
      { file: 'docs/guides/web-and-server-apps.md', route: '/guides/web-and-server-apps/', label: 'Web & server apps', description: 'The authorization-code redirect flow for confidential clients.' },
      { file: 'docs/guides/desktop-apps.md', route: '/guides/desktop-apps/', label: 'Desktop apps', description: 'Browser sign-in with PKCE over the ActionWait long-poll, for public clients.' },
      { file: 'docs/guides/govcloud.md', route: '/guides/govcloud/', label: 'GovCloud', description: 'Commercial vs Gov and the secure=1 two-token model.' },
      { file: 'docs/guides/aes.md', route: '/guides/aes/', label: 'AES (on-prem)', description: 'Customer-hosted installations of Altium Enterprise Server.' },
      { file: 'docs/guides/token-claims.md', route: '/guides/token-claims/', label: 'Access token claims', description: 'What is inside an access token: iss, workspaceId, secure, scopes.' },
      { file: 'docs/guides/register-your-application.md', route: '/guides/register-your-application/', label: 'Register your application', description: 'Client types, redirect URLs, and credentials.' },
    ],
  },
  {
    id: 'libraries',
    label: 'Libraries',
    kind: 'library',
    icon: 'libraries',
    route: '/libraries/',
    description: 'One idiomatic client per language, each validated by the same conformance vectors.',
    pages: [
      { file: 'libs/typescript/README.md', route: '/libraries/typescript/', label: 'TypeScript', description: '@altium-developer/altium-auth on npm: installation, quick start, and API reference.' },
      { file: 'libs/dotnet/README.md', route: '/libraries/dotnet/', label: '.NET', description: 'Altium.Auth on NuGet: installation, quick start, PowerShell use, and API reference.' },
      { file: 'libs/python/README.md', route: '/libraries/python/', label: 'Python', description: 'altium-auth on PyPI: installation, quick start, and API reference.' },
    ],
  },
  {
    id: 'specification',
    label: 'Specification',
    kind: 'spec',
    icon: 'specification',
    route: '/specification/',
    description: 'The normative contract every library implements, and the vectors that prove it.',
    pages: [
      { file: 'spec/SPEC.md', route: '/specification/spec/', label: 'Integration spec', description: 'The normative Altium delta over standard OAuth 2.0 / OIDC that every library implements.' },
      { file: 'spec/conformance/README.md', route: '/specification/conformance/', label: 'Conformance vectors', description: 'The language-neutral vectors every library runs, and their matchers.' },
    ],
  },
];

// Docusaurus' doc id: the repository-relative path without its extension.
const docId = (file) => file.replace(/\.mdx?$/, '');

// Every published page, in site order, with the absolute path of its source.
function allPages() {
  return SECTIONS.flatMap((section) => section.pages.map((page) => ({
    ...page,
    section: section.id,
    kind: section.kind,
    id: docId(page.file),
    source: path.join(REPO_ROOT, page.file),
  })));
}

// Front matter injected into a source file at build time, or undefined for a file that is not a listed page.
function frontMatterFor(filePath) {
  const page = allPages().find((p) => p.source === path.resolve(filePath));
  if (!page) return undefined;
  return { slug: page.route, sidebar_label: page.label, description: page.description };
}

module.exports = { REPO_ROOT, SECTIONS, docId, allPages, frontMatterFor };
