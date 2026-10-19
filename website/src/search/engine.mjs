// Search ranking shared by the browser (the theme's SearchBar, through the `search.engine` theme option), the index
// build (scripts/search-index.mjs) and the index check (scripts/search-check.mjs). Tokenizing, plurals, stop words,
// typo distance and synonyms come from the shared theme; the record kinds and the re-ranking rules are this site's.
//
// Records come from the Markdown sources, one per page and one per `##` / `###` section. MiniSearch finds candidates
// (BM25 over boosted fields); `search` then re-ranks them: a heading that is the query beats one that contains it, and
// a record that holds every query word beats one that holds a few.
import MiniSearch from 'minisearch';
import {
  compileSynonyms, coverage, dropTail, identifierWords, isStopWord, normalise, queryWords, singular, synonymsOf, tokenize,
  withinEdits,
} from '@altium-developer/docusaurus-theme/search';

// The SearchBar highlights query words with these.
export { identifierWords, isStopWord };

// Record kinds (the site's three areas), in the order of the UI tabs. `weight` is the kind's prior.
export const KINDS = {
  // The guides are the canonical explanation; the library READMEs repeat their topics per language.
  guide: { label: 'Guide', group: 'guides', weight: 1.3 },
  spec: { label: 'Spec', group: 'spec', weight: 1.0 },
  library: { label: 'Library', group: 'libraries', weight: 0.6 },
};

// The UI tabs; `tone` colours the kind pills of the group.
export const GROUPS = [
  { id: 'all', label: 'All' },
  { id: 'guides', label: 'Guides', tone: 'green' },
  { id: 'spec', label: 'Specification', tone: 'accent' },
  { id: 'libraries', label: 'Libraries', tone: 'neutral' },
];

// Stop words are dropped from body text only: headings are short, and every word in them counts.
const processTerm = (term, fieldName) => (fieldName === 'text' && isStopWord(term) ? null : term);

const FIELDS = ['name', 'title', 'text'];
const BOOST = { name: 6, title: 3, text: 1 };

export function createIndex(records) {
  const index = new MiniSearch({
    idField: 'i',
    fields: FIELDS,
    storeFields: [],
    tokenize,
    processTerm,
    extractField: (record, field) => {
      switch (field) {
        case 'i': return record.i;
        case 'name': return record.n;
        case 'title': return record.t ?? '';
        case 'text': return record.d ?? '';
        default: return undefined;
      }
    },
  });
  index.addAll(records);
  return index;
}

// How strongly the heading answers the query as a whole.
function nameBonus(record, query, allowTypos) {
  const q = normalise(query);
  if (!q) return 1;
  const name = normalise(record.n);
  if (name === q) return 8;
  const qSingular = identifierWords(query).map(singular).join('');
  if (identifierWords(record.n).map(singular).join('') === qSingular) return 6;
  if (q.length >= 3 && name.startsWith(q)) return 1.5 + 3 * (q.length / name.length);
  // Every query word starts a word of the heading ("gov" → GovCloud considerations, "on-prem" → AES (on-prem)): the
  // fewer other words the heading has, the better.
  const words = identifierWords(query).map(singular);
  const headingWords = identifierWords(record.n).map(singular);
  if (words.length && words.every((word) => headingWords.some((h) => h.startsWith(word)))) {
    return 2 + 2 * (words.length / headingWords.length);
  }
  // A mistyped heading word (`goverment`, `refesh`): one edit away, or two for long words.
  if (allowTypos && q.length >= 5 && !/\s/.test(query.trim())) {
    const allowed = q.length >= 9 ? 2 : 1;
    if (identifierWords(record.n).some((word) => withinEdits(q, word, allowed))) return 2;
  }
  return 1;
}

const haystack = (record) => `${normalise(record.n)} ${(record.t ?? '').toLowerCase()} ${(record.d ?? '').toLowerCase()}`;

/**
 * @param {MiniSearch} index from createIndex
 * @param {object[]} records the same records, indexed by their `i`
 * @param {string} query
 * @param {{group?: string, synonyms?: [RegExp, string][], limit?: number}} options (`synonyms` as returned by loadIndex)
 */
export function search(index, records, query, options = {}) {
  const { group = 'all', synonyms: synonymTable = [], limit = 50 } = options;
  const trimmed = query.trim();
  if (!trimmed) return [];
  const { words, phrase } = queryWords(trimmed);
  if (!words.length) return [];
  const synonyms = synonymsOf(trimmed, synonymTable);
  const text = [phrase ? words.join(' ') : trimmed, ...synonyms].join(' ');
  const synonymWords = synonyms.flatMap((synonym) => synonym.split(' '));
  const filter = (hit) => group === 'all' || KINDS[records[hit.id].k]?.group === group;
  const hits = index.search(text, {
    boost: BOOST,
    prefix: (term) => term.length >= 2,
    fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
    combineWith: 'OR',
    filter,
  });
  const candidates = hits.slice(0, 600);
  const q = normalise(trimmed);
  const allowTypos = !candidates.some(({ id }) => normalise(records[id].n) === q);
  const scored = candidates.map((hit) => {
    const record = records[hit.id];
    let score = hit.score * (KINDS[record.k]?.weight ?? 1);
    // A whole page (no `t`) answers a topic query better than one of its sections.
    if (!record.t) score *= PAGE_WEIGHT;
    // A heading that is a synonym of the query ("gov" → GovCloud) counts, but less than one the reader typed.
    score *= Math.max(nameBonus(record, trimmed, allowTypos), ...synonyms.map((synonym) => SYNONYM_WEIGHT * nameBonus(record, synonym, false)));
    // A record matched through a synonym answers the phrase as well as one containing its words.
    const fields = haystack(record);
    score *= synonymWords.length ? Math.max(coverage(fields, words), coverage(fields, synonymWords)) : coverage(fields, words);
    return { record, score, terms: hit.terms };
  });
  scored.sort((a, b) => b.score - a.score || a.record.n.length - b.record.n.length);
  return dropTail(scored).slice(0, limit);
}

const PAGE_WEIGHT = 1.3;
const SYNONYM_WEIGHT = 0.5;

export function loadIndex(payload) {
  const records = payload.records;
  return { records, synonyms: compileSynonyms(payload.synonyms), index: createIndex(records) };
}
