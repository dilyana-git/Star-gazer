/**
 * Find something by name and go to it.
 *
 * Fully keyboard-driven: `/` focuses it from anywhere, arrows move through the
 * results, Enter selects, Escape closes. Choosing a hit centres the sky on it
 * and opens its detail card — the same card a tap produces, because it is the
 * same object.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSearchIndex, search, type SearchHit } from '../data/search';
import type { SkyData } from '../data/catalog';
import { useStore } from '../state/store';
import { compassPoint } from '../astro/frames';

const KIND_MARK: Record<SearchHit['kind'], string> = {
  star: '✦',
  planet: '●',
  moon: '☾',
  sun: '☀',
  dso: '◇',
  constellation: '△',
};

interface SearchProps {
  data: SkyData;
  /** Take the keyboard immediately — the phone opens this as its own mode. */
  autoFocus?: boolean;
  /** Called once something has been chosen, so a host can close itself. */
  onDone?(): void;
}

export function ObjectSearch({ data, autoFocus = false, onDone }: SearchProps) {
  const site = useStore((s) => s.site);
  const instant = useStore((s) => s.instant);
  const select = useStore((s) => s.select);
  const lookAt = useStore((s) => s.lookAt);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(autoFocus);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const index = useMemo(() => buildSearchIndex(data), [data]);
  const results = useMemo(() => search(index, query), [index, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // `/` focuses the box from anywhere that is not already a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const choose = (hit: SearchHit) => {
    const object = hit.resolve(site, instant);
    select(object);
    // Constellations want the whole figure in frame; everything else is a point.
    lookAt(object.altitude, object.azimuth, hit.kind === 'constellation' ? 45 : 18);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
    onDone?.();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      onDone?.();
      return;
    }
    if (results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    }
  };

  const showing = open && query.trim().length >= 2;

  return (
    <div className="search" ref={boxRef}>
      <input
        ref={inputRef}
        type="search"
        className="search-input"
        placeholder="Find an object…  /"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={showing}
        aria-controls="search-results"
        aria-activedescendant={showing && results[active] ? `search-hit-${active}` : undefined}
        aria-label="Find a star, planet, deep sky object or constellation"
      />

      {showing && (
        <ul className="search-results" id="search-results" role="listbox">
          {results.length === 0 && (
            <li className="search-empty">
              Nothing by that name. Try a proper name (Vega), a designation (α Ori,
              alpha Ori), or a catalogue number (M31, NGC 869).
            </li>
          )}
          {results.map((hit, i) => {
            const where = hit.resolve(site, instant);
            return (
              <li key={`${hit.kind}-${hit.label}-${i}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  id={`search-hit-${i}`}
                  className={`search-hit${i === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(hit)}
                >
                  <span className="search-mark" aria-hidden="true">
                    {KIND_MARK[hit.kind]}
                  </span>
                  <span className="search-text">
                    <span className="search-label">{hit.label}</span>
                    <span className="search-hint">{hit.hint}</span>
                  </span>
                  <span className="search-where mono">
                    {where.altitude > 0
                      ? `${Math.round(where.altitude)}° ${compassPoint(where.azimuth)}`
                      : 'below horizon'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
