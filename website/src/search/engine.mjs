// Search engine shared by the browser (src/theme/SearchBar), the index build (scripts/search-index.mjs) and the index
// check (scripts/search-check.mjs). Adapted from the Altium API reference sites, trimmed to prose pages.
//
// Records come from the Markdown sources, one per page and one per `##` / `###` section. MiniSearch finds candidates
// (BM25 over boosted fields); `search` then re-ranks them: a heading that is the query beats one that contains it, and
// a record that holds every query word beats one that holds a few.
import MiniSearch from 'minisearch';

// Record kinds (the site's three areas), in the order of the UI tabs. `weight` is the kind's prior.
export const KINDS = {
  // The guides are the canonical explanation; the library READMEs repeat their topics per language.
  guide: { label: 'Guide', group: 'guides', weight: 1.3 },
  spec: { label: 'Spec', group: 'spec', weight: 1.0 },
  library: { label: 'Library', group: 'libraries', weight: 0.6 },
};

export const GROUPS = [
  { id: 'all', label: 'All' },
  { id: 'guides', label: 'Guides' },
  { id: 'spec', label: 'Specification' },
  { id: 'libraries', label: 'Libraries' },
];

// Splits an identifier into its words: `signIntoWorkspace` → sign into workspace, `access_token` → access token,
// `secure=1` → secure 1.
export function identifierWords(identifier) {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const WORD = /[A-Za-z0-9_][\w.]*[A-Za-z0-9_]|[A-Za-z0-9]/g;

// English plural → singular (`tokens` → token, `entries` → entry), leaving words that only look plural alone
// (`status`, `class`, `analysis`).
export function singular(word) {
  if (word.length <= 3 || /(?:ss|us|is|ics)$/.test(word)) return word;
  if (/ies$/.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(?:ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

// Every word becomes its lower-cased self (identifiers stay whole, `signIntoWorkspace` → `signintoworkspace`) plus its
// parts and their singulars, so a query matches either the whole name or any word in it, in either number. Used for
// both indexing and querying.
export function tokenize(text) {
  const tokens = [];
  for (const word of String(text ?? '').match(WORD) ?? []) {
    const whole = word.toLowerCase();
    tokens.push(whole);
    const parts = identifierWords(word);
    if (parts.length > 1 || parts[0] !== whole) tokens.push(...parts);
    for (const part of parts) {
      const one = singular(part);
      if (one !== part) tokens.push(one);
    }
  }
  return tokens;
}

const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from', 'how',
  'i', 'in', 'is', 'it', 'my', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'what', 'which', 'with']);

export const isStopWord = (word) => STOP_WORDS.has(word);

// Stop words are dropped from body text only: headings are short, and every word in them counts.
const processTerm = (term, fieldName) => (fieldName === 'text' && STOP_WORDS.has(term) ? null : term);

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

const normalise = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

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
  const queryWords = identifierWords(query).map(singular);
  const headingWords = identifierWords(record.n).map(singular);
  if (queryWords.length && queryWords.every((word) => headingWords.some((h) => h.startsWith(word)))) {
    return 2 + 2 * (queryWords.length / headingWords.length);
  }
  // A mistyped heading word (`goverment`, `refesh`): one edit away, or two for long words.
  if (allowTypos && q.length >= 5 && !/\s/.test(query.trim())) {
    const allowed = q.length >= 9 ? 2 : 1;
    if (identifierWords(record.n).some((word) => withinEdits(q, word, allowed))) return 2;
  }
  return 1;
}

// Damerau-Levenshtein distance (adjacent transpositions count as one edit) ≤ max, with an early exit.
export function withinEdits(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prevPrev = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (prevPrev && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, prevPrev[j - 2] + 1);
      row.push(value);
      if (value < best) best = value;
    }
    if (best > max) return false;
    prevPrev = prev;
    prev = row;
  }
  return prev[b.length] <= max;
}

// Phrasings readers use for terms the pages spell differently (SYNONYMS in scripts/search-index.mjs, compiled by
// loadIndex): `[pattern, words]`.
export const compileSynonyms = (synonyms = []) => synonyms.map(({ match, add }) => [new RegExp(match, 'i'), String(add)]);

// → the words the query stands for ("on-prem" → ['aes']); empty when none applies.
export function synonymsOf(query, synonyms = []) {
  const lower = query.toLowerCase();
  return synonyms.filter(([pattern, word]) => pattern.test(lower) && !lower.includes(word)).map(([, word]) => word);
}

// Share of the query's words that the record actually contains (in any field). BM25 already rewards it, but a single
// rare word in a long section can still beat a heading that contains two of three words; squaring keeps partial
// matches below complete ones.
function coverage(record, words) {
  if (words.length < 2) return 1;
  const haystack = `${normalise(record.n)} ${(record.t ?? '').toLowerCase()} ${(record.d ?? '').toLowerCase()}`;
  const hits = words.filter((word) => haystack.includes(word)).length;
  return (hits / words.length) ** 2;
}

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
  let words = trimmed.toLowerCase().split(/\s+/).map(normalise).filter(Boolean);
  const phrase = words.length > 2;
  if (phrase) words = words.filter((word) => !STOP_WORDS.has(word));
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
    score *= synonymWords.length ? Math.max(coverage(record, words), coverage(record, synonymWords)) : coverage(record, words);
    return { record, score, terms: hit.terms };
  });
  scored.sort((a, b) => b.score - a.score || a.record.n.length - b.record.n.length);
  // The long tail of a broad OR query (one fuzzy word out of three in a section) is noise, and it inflates the result
  // counts: keep what scores within MIN_RELATIVE_SCORE of the best.
  const floor = (scored[0]?.score ?? 0) * MIN_RELATIVE_SCORE;
  return scored.filter((result) => result.score >= floor).slice(0, limit);
}

const MIN_RELATIVE_SCORE = 0.02;
const PAGE_WEIGHT = 1.3;
const SYNONYM_WEIGHT = 0.5;

export function loadIndex(payload) {
  const records = payload.records;
  return { records, synonyms: compileSynonyms(payload.synonyms), index: createIndex(records) };
}
