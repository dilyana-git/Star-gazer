/**
 * The phone layout (spec §14.1).
 *
 * Not the desktop layout squeezed: a different information architecture for a
 * different situation. Outdoors, in the dark, one hand, and the sky is the
 * thing you came for — so the sky is full-bleed, the controls are behind one
 * tap, and everything else lives in a sheet you can push out of the way.
 *
 * The signature move is `Point`: hold the phone up at the sky and the chart
 * follows it. That is the whole reason a phone version is worth building — it
 * turns "40° up in the south-east" from an instruction you have to decode into
 * something you just look at.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { SkyCanvas } from './SkyCanvas';
import { NightRibbon } from './NightRibbon';
import { EventsPanel } from './EventsPanel';
import { DetailCard } from './DetailCard';
import { ObjectSearch } from './ObjectSearch';
import { ControlsSheet } from './ControlsSheet';
import { BottomSheet, type SheetSnap } from './BottomSheet';
import { useDeviceOrientation } from './useDeviceOrientation';
import type { SkyEvent } from '../astro/events/types';
import type { NightWindow } from '../astro/twilight';
import type { SkyData } from '../data/catalog';
import { formatTime } from '../astro/time';
import { useStore } from '../state/store';

interface Props {
  data: SkyData | null;
  reveal: number;
  night: NightWindow;
  events: SkyEvent[];
  tonight: SkyEvent[];
}

/** How much of the sheet stays on screen at rest: the ribbon and its header. */
const PEEK_HEIGHT = 152;

/** Field of view while tracking — about what you take in at a glance. */
const POINTING_FIELD = 32;

export function PhoneShell({ data, reveal, night, events, tonight }: Props) {
  const site = useStore((s) => s.site);
  const instant = useStore((s) => s.instant);
  const setInstant = useStore((s) => s.setInstant);
  const setView = useStore((s) => s.setView);
  const selected = useStore((s) => s.selected);
  const focusedEventId = useStore((s) => s.focusedEventId);
  const focusEvent = useStore((s) => s.focusEvent);
  const lookAt = useStore((s) => s.lookAt);

  const [snap, setSnap] = useState<SheetSnap>('peek');
  const [controlsOpen, setControlsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Feed the compass straight into the view. Written through a ref so the
  // callback identity never changes and the listener is not torn down and
  // rebuilt on every reading.
  const applyPointing = useRef((p: { altitude: number; azimuth: number }) => {
    setView({ centreAltitude: p.altitude, centreAzimuth: p.azimuth });
  });
  const orientation = useDeviceOrientation(useCallback((p) => applyPointing.current(p), []));
  const tracking = orientation.status === 'tracking' || orientation.status === 'no-compass';

  // Entering and leaving tracking changes the field of view, not just the
  // centre: pointing at a patch of sky wants a patch-sized view.
  const wasTracking = useRef(false);
  useEffect(() => {
    if (tracking && !wasTracking.current) setView({ fieldRadius: POINTING_FIELD });
    if (!tracking && wasTracking.current) setView({ fieldRadius: 90, centreAltitude: 90, centreAzimuth: 0 });
    wasTracking.current = tracking;
  }, [tracking, setView]);

  // Tracking and the sheet compete for the screen; pushing the sheet down when
  // tracking starts is what you would do by hand anyway.
  useEffect(() => {
    if (tracking) setSnap('peek');
  }, [tracking]);

  const togglePointing = () => (tracking ? orientation.stop() : void orientation.start());

  return (
    // The peek height is one number shared with the stylesheet, so the floating
    // actions can sit exactly above the sheet's resting edge without either
    // side guessing.
    <div className="phone" style={{ '--sheet-peek': `${PEEK_HEIGHT}px` } as React.CSSProperties}>
      <button type="button" className="phone-status" onClick={() => setControlsOpen(true)}>
        <span className="phone-status-where">{site.label}</span>
        <span className="phone-status-when mono">{formatTime(instant, site.timezone)}</span>
        <span className="phone-status-more" aria-hidden="true">
          ⋯
        </span>
      </button>

      <div className="phone-sky">
        {data ? (
          <SkyCanvas data={data} reveal={reveal} interactive={!tracking} />
        ) : (
          <div className="boot">
            <p>Loading the sky…</p>
          </div>
        )}

        {searchOpen && data && (
          <div className="phone-search">
            <ObjectSearch data={data} autoFocus onDone={() => setSearchOpen(false)} />
            <button type="button" className="tap-target" onClick={() => setSearchOpen(false)}>
              Cancel
            </button>
          </div>
        )}

        {selected && <DetailCard target={selected} />}

        {orientation.status === 'no-compass' && (
          <p className="phone-warning">
            No compass on this device — the height is right but the bearing is not. Turn until the
            horizon matches and read it as a relative view.
          </p>
        )}
        {orientation.status === 'denied' && (
          <p className="phone-warning">
            Motion access was refused. Allow it in your browser settings to point at the sky, or drag
            the chart instead.
          </p>
        )}

        <div className="phone-actions">
          {!searchOpen && (
            <button
              type="button"
              className="fab"
              onClick={() => setSearchOpen(true)}
              aria-label="Find an object"
            >
              <SearchGlyph />
            </button>
          )}

          {orientation.status !== 'unsupported' && (
            <button
              type="button"
              className={`fab fab-primary${tracking ? ' is-on' : ''}`}
              onClick={togglePointing}
              aria-pressed={tracking}
              aria-label={tracking ? 'Stop following the phone' : 'Point the phone at the sky'}
            >
              <CompassGlyph />
              <span className="fab-label">{tracking ? 'Stop' : 'Point'}</span>
            </button>
          )}
        </div>
      </div>

      <BottomSheet
        peekHeight={PEEK_HEIGHT}
        snap={snap}
        onSnapChange={setSnap}
        header={
          <div className="sheet-summary">
            <NightRibbon
              site={site}
              night={night}
              instant={instant}
              events={tonight}
              focusedEventId={focusedEventId}
              onScrub={setInstant}
              onSelectEvent={(event) => {
                focusEvent(event.id);
                setInstant(event.peak);
              }}
              compact
            />
            <p className="sheet-count">
              {tonight.length === 0
                ? 'Nothing unusual tonight'
                : `${tonight.length} worth going outside for`}
            </p>
          </div>
        }
      >
        <EventsPanel
          site={site}
          events={events}
          tonight={tonight}
          night={night}
          focusedEventId={focusedEventId}
          onSelect={(event) => {
            focusEvent(event.id);
            setInstant(event.peak);
            lookAt(event.bestAltitude, event.bestAzimuth);
            if (tracking) orientation.stop();
            setSnap('peek');
          }}
        />
      </BottomSheet>

      {controlsOpen && <ControlsSheet onClose={() => setControlsOpen(false)} />}
    </div>
  );
}

function CompassGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M15.5 8.5 L10.5 10.5 L8.5 15.5 L13.5 13.5 Z" fill="currentColor" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M15.5 15.5 L21 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
