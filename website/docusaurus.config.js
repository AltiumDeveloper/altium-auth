// @ts-check
// Docusaurus site for docs/ (guides), spec/ (SPEC.md + conformance README) and libs/*/README.md, read in place: one
// docs plugin instance per directory, so nothing is copied and "Edit this page" opens the real source.
// The look (src/css, src/theme, search) follows the other Altium developer reference sites:
// https://github.com/AltiumDeveloper/ad-sdk-docs and https://github.com/AltiumDeveloper/platform-api-docs.
const path = require('node:path');
const { themes } = require('prism-react-renderer');
const { REPO_ROOT, SECTIONS, docId, frontMatterFor } = require('./pages.cjs');

const REPO = 'https://github.com/AltiumDeveloper/altium-auth';
const BRANCH = 'main';
const DEVELOPER_CENTER = 'https://developer.altium.com/';
const DEVELOPER_CENTER_DOCS = 'https://www.altium.com/documentation/altium-developer-center';

// Docs plugin options for one section of pages.cjs.
function docsOptions(section) {
  return {
    path: path.join(REPO_ROOT, section.dir),
    routeBasePath: section.route,
    include: section.pages.map((page) => page.file),
    sidebarPath: require.resolve('./sidebars.js'),
    sidebarItemsGenerator: () => sidebarItems(section),
    editUrl: ({ docPath }) => `${REPO}/edit/${BRANCH}/${section.dir}/${docPath}`,
  };
}

// The section's sidebar in pages.cjs order: the home page on its own, the other pages under a small-caps heading.
function sidebarItems(section) {
  const docs = section.pages.map((page) => ({ type: 'doc', id: docId(page.file) }));
  const lead = docs[0]?.id === 'index' ? [docs.shift()] : [];
  return [...lead, { type: 'category', label: section.label, collapsible: false, items: docs }];
}

const [guides, ...others] = SECTIONS;

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Altium 365 Authentication',
  tagline: 'OAuth 2.0 / OpenID Connect client libraries and specification for Altium 365',
  url: 'https://altiumdeveloper.github.io',
  baseUrl: '/altium-auth/',
  organizationName: 'AltiumDeveloper',
  projectName: 'altium-auth',
  favicon: 'img/favicon.svg',
  // Keeps the MkDocs URLs (/guides/overview/): package READMEs link to them, and giscus threads are keyed by them.
  trailingSlash: true,
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: {
    // .md is CommonMark, not MDX: the sources are shared with GitHub and the package registries.
    format: 'detect',
    mermaid: true,
    hooks: { onBrokenMarkdownLinks: 'throw' },
    // Sidebar labels, descriptions and slugs come from pages.cjs, so the sources need no front matter.
    parseFrontMatter: async (params) => {
      const result = await params.defaultParseFrontMatter(params);
      return { ...result, frontMatter: { ...frontMatterFor(params.filePath), ...result.frontMatter } };
    },
  },
  themes: ['@docusaurus/theme-mermaid'],
  plugins: [
    // Search: src/theme/SearchBar over static/search-index.json (npm run search:index), also published under a
    // content-hashed name (usePluginData('search-index').file).
    './plugins/search-index.cjs',
    ...others.map((section) => ['@docusaurus/plugin-content-docs', { id: section.id, ...docsOptions(section) }]),
  ],
  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        blog: false,
        docs: docsOptions(guides),
        theme: { customCss: './src/css/custom.css' },
      }),
    ],
  ],
  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: { respectPrefersColorScheme: true },
      navbar: {
        title: 'Altium 365 Authentication',
        logo: { alt: 'Altium', src: 'img/altium-logo.svg', width: 90, height: 20 },
        items: [
          ...SECTIONS.map((section) => ({
            type: 'docSidebar',
            sidebarId: 'pages',
            docsPluginId: section.id,
            label: section.label,
            position: 'left',
          })),
          { href: DEVELOPER_CENTER, label: 'Developer Center', position: 'right' },
          { href: REPO, label: 'GitHub', position: 'right' },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Altium',
            items: [
              { label: 'Developer Center', href: DEVELOPER_CENTER },
              { label: 'Developer Center documentation', href: DEVELOPER_CENTER_DOCS },
              { label: 'Altium 365 API reference', href: 'https://altiumdeveloper.github.io/platform-api-docs/' },
              { label: 'Altium Designer SDK reference', href: 'https://altiumdeveloper.github.io/ad-sdk-docs/' },
            ],
          },
          {
            title: 'This site',
            items: [
              { label: 'For AI assistants (llms.txt)', href: 'pathname:///llms.txt' },
              { label: 'Source on GitHub', href: REPO },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Altium.`,
      },
      prism: { theme: themes.github, darkTheme: themes.oneDark, additionalLanguages: ['bash', 'csharp', 'powershell'] },
    }),
};

module.exports = config;
