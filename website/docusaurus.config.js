// @ts-check
// Docusaurus site for docs/ (guides), spec/ (SPEC.md + conformance README) and libs/*/README.md, read in place: one
// docs plugin over the repository root that includes only the pages listed in pages.cjs, so nothing is copied,
// relative links between the files work as they do on GitHub, and "Edit this page" opens the real source.
// The look (src/css, src/theme, search) follows the other Altium developer reference sites:
// https://github.com/AltiumDeveloper/ad-sdk-docs and https://github.com/AltiumDeveloper/platform-api-docs.
const { themes } = require('prism-react-renderer');
const { REPO_ROOT, SECTIONS, allPages, docId, frontMatterFor } = require('./pages.cjs');

const REPO = 'https://github.com/AltiumDeveloper/altium-auth';
const BRANCH = 'main';
const DEVELOPER_CENTER = 'https://developer.altium.com/';
const DEVELOPER_CENTER_DOCS = 'https://www.altium.com/documentation/altium-developer-center';

// The sidebar: the Home link, then one group per section, in pages.cjs order. Like the namespaces of the Altium
// Designer SDK reference, each carries a coloured icon (`bc-<icon>` in src/css/custom.css). There is little content,
// so the groups are always expanded and their titles are labels, not links (`section-root`).
function sidebarItems() {
  return SECTIONS.map((section) => {
    const docs = section.pages.map((page) => ({ type: 'doc', id: docId(page.file) }));
    if (section.id === 'home') return { ...docs[0], className: `bc-${section.icon}` };
    return { type: 'category', label: section.label, collapsible: false, className: `bc-${section.icon} section-root`, items: docs };
  });
}

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
  ],
  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        blog: false,
        docs: {
          path: REPO_ROOT,
          routeBasePath: '/',
          include: allPages().map((page) => page.file),
          sidebarPath: require.resolve('./sidebars.js'),
          sidebarItemsGenerator: sidebarItems,
          editUrl: ({ docPath }) => `${REPO}/edit/${BRANCH}/${docPath}`,
        },
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
