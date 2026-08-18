/**
 * The ranked list (spec §7, §9). Each entry: title, plain-language detail,
 * time, altitude and direction, equipment badge, and an expandable score
 * breakdown. Tapping one scrubs the ribbon to its peak and centres the sky.
 */
import { useMemo } from 'react';
import type { SkyEvent } from '../astro/events/types';
import type { NightWindow } from '../astro/twilight';
import type { Site } from '../astro/types';
import { formatDate, formatTime } from '../astro/time';
import { describeRecurrence } from '../astro/events/scoring';

interface Props {
  site: Site;
  /** Everything found in the fortnight ahead. */
  events: SkyEvent[];
  /** Just tonight's. */
  tonight: SkyEvent[];
  night: NightWindow;
  focusedEventId: string | null;
  onSelect(event: SkyEvent): void;
}

const EQUIPMENT_LABEL: Record<SkyEvent['equipment'], string> = {
  'naked-eye': 'naked eye',
  binocular: 'binoculars',
  telescope: 'telescope',
};

export function EventsPanel({ site, events, tonight, night, focusedEventId, onSelect }: Props) {
  // Some events recur every clear night — Saturn is well placed for months, the
  // Pleiades for a season. Tonight's list wants them; a fortnight's list wants
  // one entry each, on the best night. That is a presentation decision, so it
  // is made here rather than in the detectors.
  const upcoming = useMemo(() => {
    const best = new Map<string, SkyEvent>();
    for (const event of events) {
      if (event.peak <= night.bounds[1]) continue;
      const existing = best.get(event.title);
      if (!existing || event.score > existing.score) best.set(event.title, event);
    }
    return [...best.values()].sort((a, b) => b.score - a.score || a.peak - b.peak).slice(0, 12);
  }, [events, night.bounds]);

  return (
    <section className="events" aria-label="Events worth going outside for">
      <header className="events-head">
        <h2>Tonight</h2>
        <p>
          {formatDate(night.bounds[0], site.timezone)} · {site.label}
        </p>
      </header>

      {tonight.length === 0 ? (
        <p className="events-empty">
          {night.darknessNote ??
            'Nothing unusual tonight. The sky is still there — scrub the ribbon and have a look around.'}
        </p>
      ) : (
        tonight.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            site={site}
            focused={event.id === focusedEventId}
            onSelect={onSelect}
          />
        ))
      )}

      {upcoming.length > 0 && (
        <>
          <p className="events-section">The fortnight ahead</p>
          {upcoming.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              site={site}
              focused={event.id === focusedEventId}
              onSelect={onSelect}
              showDate
            />
          ))}
        </>
      )}
    </section>
  );
}

function EventRow({
  event,
  site,
  focused,
  onSelect,
  showDate = false,
}: {
  event: SkyEvent;
  site: Site;
  focused: boolean;
  onSelect(event: SkyEvent): void;
  showDate?: boolean;
}) {
  return (
    <div className={`event${focused ? ' is-focused' : ''}`}>
      <button type="button" className="event-head" onClick={() => onSelect(event)}>
        <span className="event-score" style={{ color: scoreColor(event.score) }}>
          {event.score}
        </span>
        <span className="event-title">{event.title}</span>
      </button>

      <p className="event-detail">{event.detail}</p>

      <p className="event-data">
        <span>
          {showDate ? `${formatDate(event.peak, site.timezone)}, ` : ''}
          {formatTime(event.peak, site.timezone)}
        </span>
        <span>
          {event.bestAltitude >= 0 ? `${Math.round(event.bestAltitude)}°` : 'below horizon'} ·{' '}
          {Math.round(event.bestAzimuth)}°
        </span>
        <span className="event-badge">{EQUIPMENT_LABEL[event.equipment]}</span>
      </p>

      <details className="event-breakdown">
        <summary>Why {event.score}?</summary>
        <ScoreBreakdown event={event} />
      </details>
    </div>
  );
}

function ScoreBreakdown({ event }: { event: SkyEvent }) {
  const c = event.components;
  const rows: Array<[string, number, string]> = [
    ['Rarity', c.rarity / 100, `${c.rarity}/100`],
    ['Visibility', c.visibility, c.visibility.toFixed(2)],
    ['Interference', c.interference, c.interference.toFixed(2)],
    ['Access', c.accessibility, c.accessibility.toFixed(2)],
  ];

  return (
    <>
      <dl className="score-rows">
        {rows.map(([label, fraction, value]) => (
          <div className="score-row" key={label}>
            <dt>{label}</dt>
            <div className="score-bar">
              <span style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }} />
            </div>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <ul className="score-notes">
        <li>Rarity from an interval of {describeRecurrence(c.recurrenceDays)}.</li>
        {c.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
        <li>
          {c.rarity} × {c.visibility.toFixed(2)} × {c.interference.toFixed(2)} × {c.accessibility.toFixed(2)} ={' '}
          {event.score}
        </li>
      </ul>
    </>
  );
}

/** Higher scores glow. Within the palette — no accent colour for "alerts". */
function scoreColor(score: number): string {
  if (score >= 55) return 'var(--gold-lit)';
  if (score >= 25) return 'var(--gold)';
  return 'var(--ink-faint)';
}
