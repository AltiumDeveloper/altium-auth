// Local Docusaurus plugin: publishes static/search-index.json (npm run search:index) under a content-hashed name, so a
// deploy never pairs a cached index with new SearchBar code. Global data (usePluginData('search-index')):
//   { file: 'search-index.<hash>.json' }   file name at the site root (prefix with baseUrl), or
//   { file: null }                         when the index has not been built.
// static/search-index.json is still copied as-is: the dev server serves it, and it is the fallback name.
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const contentHash = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 10);
const hashedName = (bytes) => `search-index.${contentHash(bytes)}.json`;

function searchIndexPlugin(context, { source = 'static/search-index.json' } = {}) {
  const path = join(context.siteDir, source);
  return {
    name: 'search-index',
    getPathsToWatch: () => [path],
    async loadContent() {
      if (!existsSync(path)) return { file: null, bytes: null };
      // The dev server only serves static/ as-is: there the SearchBar must use the plain name.
      if (process.env.NODE_ENV !== 'production') return { file: null, bytes: null };
      const bytes = readFileSync(path);
      return { file: hashedName(bytes), bytes };
    },
    // setGlobalData is only available here, not in loadContent.
    async contentLoaded({ content, actions }) {
      actions.setGlobalData({ file: content.file });
    },
    async postBuild({ content, outDir }) {
      if (content.file) writeFileSync(join(outDir, content.file), content.bytes);
    },
  };
}

module.exports = searchIndexPlugin;
module.exports.contentHash = contentHash;
module.exports.hashedName = hashedName;
