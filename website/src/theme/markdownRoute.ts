// `npm run llms` writes a Markdown twin next to every built page:
// /reference/design/overview → /reference/design/overview.md, the home page → /index.md.
// `permalink` is the doc's permalink (it includes `baseUrl`); the result is a base-URL-prefixed path.
export function markdownHref(permalink: string, baseUrl: string): string {
  const route = permalink.slice(baseUrl.length).replace(/\/+$/, '');
  return `${baseUrl}${route === '' ? 'index' : route}.md`;
}
