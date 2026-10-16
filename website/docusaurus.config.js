// @ts-check
// Docusaurus site for docs/ (guides), spec/ (SPEC.md + conformance README) and libs/*/README.md, read in place: one
// docs plugin over the repository root that includes only the pages listed in pages.cjs, so nothing is copied,
// relative links between the files work as they do on GitHub, and "Edit this page" opens the real source.
// The look (CSS, fonts, logo, "View as Markdown", the search UI) is the theme shared with the other Altium developer
// sites, https://github.com/AltiumDeveloper/docusaurus-theme (installed from its GitHub Release tarball; to update,
// change the version in the package.json URL); search ranking (src/search/engine.mjs) is this site's.
const { themes } = require('prism-react-renderer');
const altiumTheme = require('@altium-developer/docusaurus-theme');
const { REPO_ROOT, SECTIONS, allPages, docId, frontMatterFor } = require('./pages.cjs');

const REPO = 'https://github.com/AltiumDeveloper/altium-auth';
const BRANCH = 'main';
const DEVELOPER_CENTER = 'https://developer.altium.com/';
const DEVELOPER_CENTER_DOCS = 'https://www.altium.com/documentation/altium-developer-center';

// The sidebar, laid out like the other Altium developer sites: the home page link, then one small-caps heading per
// section over its pages, always expanded (the theme styles level-1 categories as headings). Pages with an `icon`
// get its swatch before the label (`bc-<icon>` in src/css/custom.css).
function sidebarItems() {
  return SECTIONS.map((section) => {
    const docs = section.pages.map((page) => ({
      type: 'doc',
      id: docId(page.file),
      ...(page.icon && { className: `bc-${page.icon}` }),
    }));
    if (section.id === 'home') return docs[0];
    return { type: 'category', label: section.label, collapsible: false, items: docs };
  });
}

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Altium Authentication',
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
  // The theme's img/ (logo, favicon) next to this site's static/.
  staticDirectories: ['static', altiumTheme.staticDir],
  themes: [
    '@docusaurus/theme-mermaid',
    [
      '@altium-developer/docusaurus-theme',
      {
        // The theme's SearchBar over static/search-index.json (npm run search:index), ranked by src/search/engine.mjs.
        search: {
          engine: 'src/search/engine.mjs',
          recentKey: 'altium-auth-search-recent',
          placeholder: 'Search guides, the specification and the libraries',
          examples: [
            { query: 'actionwait', text: 'the desktop sign-in flow' },
            { query: ['secure=1', 'gov'], text: 'GovCloud tokens' },
            { query: 'refresh token', text: 'refreshing and revoking' },
            { query: 'signIntoWorkspace', text: 'a library method' },
          ],
        },
      },
    ],
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
        title: 'Altium Authentication',
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
