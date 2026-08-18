import { useEffect, useMemo, useRef, useState } from 'react';
import { Controls } from './ui/Controls';
import { SkyCanvas } from './ui/SkyCanvas';
import { NightRibbon } from './ui/NightRibbon';
import { EventsPanel } from './ui/EventsPanel';
import { DetailCard } from './ui/DetailCard';
import { LayerToggles } from './ui/LayerToggles';
import { ObjectSearch } from './ui/ObjectSearch';
import { NightVisionFilter } from './ui/NightVisionFilter';
import { NightPlan } from './ui/NightPlan';
import { ShareBar } from './ui/ShareBar';
import { loadSkyData, type SkyData } from './data/catalog';
import { nightWindowFor } from './astro/twilight';
import { findEvents } from './astro/events';
import { useStore, syncPermalinkToUrl } from './state/store';
import { DAY } from './astro/time';

export default function App() {
  const [data, setData] = useState<SkyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reveal = useDarkAdaptation(data !== null);

  const site = useStore((s) => s.site);
  const instant = useStore((s) => s.instant);
  const nightMode = useStore((s) => s.nightMode);
  const setInstant = useStore((s) => s.setInstant);
  const selected = useStore((s) => s.selected);
  const focusedEventId = useStore((s) => s.focusedEventId);
  const focusEvent = useStore((s) => s.focusEvent);
  const lookAt = useStore((s) => s.lookAt);

  useEffect(() => {
    loadSkyData().then(setData, (e: Error) => setError(e.message));
  }, []);

  // Keep the address bar showing the sky on screen, so copying the URL at any
  // moment shares what is being looked at.
  useEffect(syncPermalinkToUrl, []);

  const night = useMemo(() => nightWindowFor(site, instant), [site, instant]);

  // Events for the night on screen, plus the fortnight around it so the panel
  // can say "nothing tonight, but the Perseids peak on Thursday".
  const events = useMemo(
    () => findEvents(site, night.bounds[0] - DAY, night.bounds[1] + 13 * DAY),
    [site, night.bounds],
  );

  const tonight = useMemo(
    () => events.filter((e) => e.peak >= night.bounds[0] && e.peak <= night.bounds[1]),
    [events, night.bounds],
  );

  if (error) {
    return (
      <main className="boot boot-error">
        <h1>Sidereal</h1>
        <p>The star catalogue could not be loaded: {error}</p>
        <p className="boot-hint">
          If this is a fresh checkout, run <code>npm run build:catalogs</code> first.
        </p>
      </main>
    );
  }

  return (
    <div className={`app${nightMode ? ' night-mode' : ''}`}>
      <NightVisionFilter />

      <header className="masthead">
        <h1>Sidereal</h1>
        <p className="masthead-sub">{site.label}</p>
        <ShareBar />
      </header>

      <Controls />

      <main className="stage">
        <section className="stage-sky">
          {data ? (
            <SkyCanvas data={data} reveal={reveal} />
          ) : (
            <div className="boot">
              <p>Loading the sky…</p>
            </div>
          )}
          <LayerToggles />
          {data && <ObjectSearch data={data} />}
          {selected && <DetailCard target={selected} />}
        </section>

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
          }}
        />
      </main>

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
      />

      <NightPlan site={site} night={night} events={tonight} />
    </div>
  );
}

/**
 * The one orchestrated moment (spec §10): the sky fades up over about 1.2s with
 * stars appearing in descending order of brightness, the way real dark
 * adaptation works. Respects `prefers-reduced-motion`.
 */
function useDarkAdaptation(ready: boolean): number {
  const [reveal, setReveal] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setReveal(1);
      return;
    }

    let frame = 0;
    const DURATION = 1200;
    const step = (now: number) => {
      startedAt.current ??= now;
      const t = Math.min(1, (now - startedAt.current) / DURATION);
      setReveal(t);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  return reveal;
}
