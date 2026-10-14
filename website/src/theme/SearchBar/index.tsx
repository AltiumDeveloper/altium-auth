// Site search: a navbar button (⌘K / Ctrl+K, or "/") opening a modal over static/search-index.json.
// Ranking lives in src/search/engine.mjs; this file is only the UI. The index and MiniSearch are loaded on first use
// (hovering or focusing the button prefetches them), so they cost nothing on page load.
import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useHistory } from '@docusaurus/router';
import { useBaseUrlUtils } from '@docusaurus/useBaseUrl';
import useGlobalData from '@docusaurus/useGlobalData';
import styles from './styles.module.css';

// The index under its content-hashed name (plugins/search-index.cjs), so a cached index never meets newer code; the
// plain name when the plugin has no index (dev server).
function useIndexUrl(): string {
  const { withBaseUrl } = useBaseUrlUtils();
  const file = (useGlobalData() as any)?.['search-index']?.default?.file as string | null | undefined;
  return withBaseUrl(`/${file ?? 'search-index.json'}`);
}

type SearchRecord = { i: number; n: string; k: string; u: string; d?: string; t?: string };
type Result = { record: SearchRecord; score: number };
type Loaded = { engine: any; index: any; records: SearchRecord[]; synonyms: unknown[] };
type Recent = { n: string; k: string; u: string; t?: string };

const RECENT_KEY = 'altium-auth-search-recent';
const RECENT_MAX = 8;
const SHOWN = 60;

let loading: Promise<Loaded> | null = null;
function loadSearch(indexUrl: string): Promise<Loaded> {
  loading ??= Promise.all([
    // @ts-ignore — plain ES module shared with the build scripts
    import('../../search/engine.mjs'),
    fetch(indexUrl).then((response) => {
      if (!response.ok) throw new Error(`search index: HTTP ${response.status}`);
      return response.json();
    }),
  ]).then(([engine, payload]) => ({ engine, ...engine.loadIndex(payload) }));
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

function readRecent(): Recent[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function remember(record: SearchRecord) {
  const entry: Recent = { n: record.n, k: record.k, u: record.u, t: record.t };
  const rest = readRecent().filter((recent) => recent.u !== entry.u);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([entry, ...rest].slice(0, RECENT_MAX)));
  } catch {
    // private mode: no history
  }
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Marks the parts of `text` that start with a query word.
function Highlight({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const pattern = new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'ig');
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <mark key={i} className={styles.mark}>{part}</mark> : <React.Fragment key={i}>{part}</React.Fragment>))}
    </>
  );
}

function KindPill({ kind, engine }: { kind: string; engine: any }) {
  const meta = engine?.KINDS?.[kind];
  return <span className={`${styles.kind} ${styles[`kind_${meta?.group ?? 'guides'}`]}`}>{meta?.label ?? kind}</span>;
}

function ResultRow({ result, active, words, loaded, onPick, onHover, id }: {
  result: Result; active: boolean; words: string[]; loaded: Loaded; onPick: (r: SearchRecord, newTab: boolean) => void;
  onHover: () => void; id: string;
}) {
  const { record } = result;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <li
      ref={ref}
      id={id}
      role="option"
      aria-selected={active}
      className={`${styles.result} ${active ? styles.active : ''}`}
      onMouseMove={onHover}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => onPick(record, event.metaKey || event.ctrlKey)}
    >
      <div className={styles.line}>
        <KindPill kind={record.k} engine={loaded.engine} />
        <span className={styles.guideName}><Highlight text={record.n} words={words} /></span>
      </div>
      <div className={styles.description}>
        {record.t && record.t !== record.n && <span className={styles.page}>{record.t} › </span>}
        {record.d && <Highlight text={record.d.length > 180 ? `${record.d.slice(0, 179)}…` : record.d} words={words} />}
      </div>
    </li>
  );
}

function SearchModal({ onClose, initialQuery }: { onClose: () => void; initialQuery: string }) {
  const { withBaseUrl } = useBaseUrlUtils();
  const indexUrl = useIndexUrl();
  const history = useHistory();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [group, setGroup] = useState('all');
  const [active, setActive] = useState(0);
  const [recent] = useState(readRecent);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSearch(indexUrl).then(setLoaded, (err) => setError(String(err?.message ?? err)));
    inputRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [indexUrl]);

  const { results, counts, elapsed } = useMemo(() => {
    const empty = { results: [] as Result[], counts: {} as Record<string, number>, elapsed: 0 };
    if (!loaded || !query.trim()) return empty;
    const started = performance.now();
    const all: Result[] = loaded.engine.search(loaded.index, loaded.records, query, { synonyms: loaded.synonyms, limit: 400 });
    const tally: Record<string, number> = { all: all.length };
    for (const { record } of all) {
      const g = loaded.engine.KINDS[record.k]?.group;
      tally[g] = (tally[g] ?? 0) + 1;
    }
    const inGroup = group === 'all' ? all : all.filter(({ record }) => loaded.engine.KINDS[record.k]?.group === group);
    return { results: inGroup.slice(0, SHOWN), counts: tally, elapsed: performance.now() - started };
  }, [loaded, query, group]);

  const words = useMemo(
    () => (loaded
      ? ([...new Set(query.trim().split(/\s+/).flatMap((w) => loaded.engine.identifierWords(w)))] as string[])
        .filter((w) => w.length >= 2 && !loaded.engine.isStopWord(w))
      : []),
    [loaded, query],
  );

  useEffect(() => {
    setActive(0);
  }, [query, group]);

  const pick = useCallback((record: SearchRecord | Recent, newTab = false) => {
    if ('i' in record) remember(record as SearchRecord);
    const href = withBaseUrl(record.u);
    if (newTab) {
      window.open(href, '_blank', 'noopener');
      return;
    }
    onClose();
    history.push(href);
  }, [history, onClose, withBaseUrl]);

  const recentShown = !query.trim() ? recent : [];
  const listLength = query.trim() ? results.length : recentShown.length;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(listLength - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = query.trim() ? results[active]?.record : recentShown[active];
      if (target) pick(target, event.metaKey || event.ctrlKey);
    } else if (event.key === 'Tab' && query.trim()) {
      // Tab / Shift+Tab cycle the area tabs.
      event.preventDefault();
      const ids = loaded?.engine.GROUPS.map((g: { id: string }) => g.id) ?? ['all'];
      const next = (ids.indexOf(group) + (event.shiftKey ? -1 : 1) + ids.length) % ids.length;
      setGroup(ids[next]);
    }
  };

  return createPortal(
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Search the documentation" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className={styles.header}>
          <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden="true"><path d="M14.4 12.9l4.3 4.3-1.5 1.5-4.3-4.3a7.5 7.5 0 111.5-1.5zM8.5 14a5.5 5.5 0 100-11 5.5 5.5 0 000 11z" fill="currentColor" /></svg>
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search guides, the specification and the libraries"
            aria-label="Search"
            aria-controls="site-search-results"
            aria-activedescendant={listLength ? `site-search-${active}` : undefined}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="button" className={styles.esc} onClick={onClose} aria-label="Close search">esc</button>
        </div>
        <div className={styles.filters}>
          <div className={styles.tabs} role="tablist">
            {(loaded?.engine.GROUPS ?? [{ id: 'all', label: 'All' }]).map((g: { id: string; label: string }) => (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={group === g.id}
                className={`${styles.tab} ${group === g.id ? styles.tabActive : ''}`}
                onClick={() => {
                  setGroup(g.id);
                  inputRef.current?.focus();
                }}
              >
                {g.label}
                {query.trim() && loaded ? <span className={styles.count}>{counts[g.id] ?? 0}</span> : null}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.body}>
          {error && <p className={styles.empty}>Search is unavailable: {error}</p>}
          {!error && !loaded && <p className={styles.empty}>Loading the index…</p>}
          {loaded && !query.trim() && (
            recentShown.length ? (
              <>
                <div className={styles.section}>Recently opened</div>
                <ul className={styles.list} id="site-search-results" role="listbox">
                  {recentShown.map((item, i) => (
                    <li
                      key={item.u}
                      id={`site-search-${i}`}
                      role="option"
                      aria-selected={i === active}
                      className={`${styles.result} ${i === active ? styles.active : ''}`}
                      onMouseMove={() => setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(event) => pick(item, event.metaKey || event.ctrlKey)}
                    >
                      <div className={styles.line}>
                        <KindPill kind={item.k} engine={loaded.engine} />
                        <span className={styles.guideName}>{item.n}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className={styles.tips}>
                <p>Type a few words or a name. Headings that match come first.</p>
                <ul>
                  <li><code>actionwait</code>: the desktop sign-in flow</li>
                  <li><code>secure=1</code> or <code>gov</code>: GovCloud tokens</li>
                  <li><code>refresh token</code>: refreshing and revoking</li>
                  <li><code>signIntoWorkspace</code>: a library method</li>
                </ul>
              </div>
            )
          )}
          {loaded && query.trim() && (results.length ? (
            <ul className={styles.list} id="site-search-results" role="listbox">
              {results.map((result: Result, i: number) => (
                <ResultRow
                  key={result.record.i}
                  id={`site-search-${i}`}
                  result={result}
                  active={i === active}
                  words={words}
                  loaded={loaded}
                  onPick={pick}
                  onHover={() => setActive(i)}
                />
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>No results for “{query.trim()}”{group !== 'all' ? ' in this area' : ''}.</p>
          ))}
        </div>
        <div className={styles.footer}>
          <span><kbd>↑</kbd><kbd>↓</kbd> select</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>{isMac() ? '⌘' : 'Ctrl'}</kbd><kbd>↵</kbd> new tab</span>
          <span><kbd>tab</kbd> next area</span>
          <span className={styles.spacer} />
          {query.trim() && loaded ? <span>{counts.all ?? 0} results · {elapsed.toFixed(0)} ms</span> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function SearchBar(): ReactNode {
  const indexUrl = useIndexUrl();
  const [open, setOpen] = useState(false);
  const [initialQuery, setInitialQuery] = useState('');
  const [mac, setMac] = useState(false);
  const prefetch = useCallback(() => {
    loadSearch(indexUrl).catch(() => {});
  }, [indexUrl]);

  useEffect(() => {
    setMac(isMac());
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setInitialQuery('');
        setOpen((o) => !o);
      } else if (event.key === '/' && !typing) {
        event.preventDefault();
        setInitialQuery('');
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        className={styles.button}
        onClick={() => setOpen(true)}
        onMouseEnter={prefetch}
        onFocus={prefetch}
        aria-label="Search the documentation"
      >
        <svg className={styles.buttonIcon} viewBox="0 0 20 20" aria-hidden="true"><path d="M14.4 12.9l4.3 4.3-1.5 1.5-4.3-4.3a7.5 7.5 0 111.5-1.5zM8.5 14a5.5 5.5 0 100-11 5.5 5.5 0 000 11z" fill="currentColor" /></svg>
        <span className={styles.buttonLabel}>Search</span>
        <span className={styles.buttonKeys}><kbd>{mac ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd></span>
      </button>
      {open && <SearchModal initialQuery={initialQuery} onClose={() => setOpen(false)} />}
    </>
  );
}
