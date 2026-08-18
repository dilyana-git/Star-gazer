/**
 * A night plan you can print and take outside (spec §11, Phase 4).
 *
 * Rendered into the page but hidden until printing, so there is no second
 * rendering path to keep in step — what prints is the same data the panel is
 * showing. Laid out for paper: black on white, no canvas, no colour, and the
 * times in a column you can read by red torchlight.
 */
import type { SkyEvent } from '../astro/events/types';
import type { NightWindow } from '../astro/twilight';
import type { Site } from '../astro/types';
import { compassPoint } from '../astro/frames';
import { formatDate, formatTime } from '../astro/time';
import { bortleBaseMag } from '../astro/twilight';

interface Props {
  site: Site;
  night: NightWindow;
  events: SkyEvent[];
}

const EQUIPMENT_LABEL: Record<SkyEvent['equipment'], string> = {
  'naked-eye': 'naked eye',
  binocular: 'binoculars',
  telescope: 'telescope',
};

export function NightPlan({ site, night, events }: Props) {
  const tz = site.timezone;

  return (
    <article className="night-plan" aria-hidden="true">
      <header>
        <h1>Night plan — {formatDate(night.bounds[0], tz)}</h1>
        <p>
          {site.label} · {site.latitude.toFixed(3)}°{site.latitude >= 0 ? 'N' : 'S'}{' '}
          {Math.abs(site.longitude).toFixed(3)}°{site.longitude >= 0 ? 'E' : 'W'} · Bortle {site.bortle},
          naked eye to magnitude {bortleBaseMag(site.bortle).toFixed(1)}
        </p>
      </header>

      <section>
        <h2>The night</h2>
        <table>
          <tbody>
            <Row label="Sunset" at={night.sunset} tz={tz} />
            <Row label="Civil dusk" at={night.civilDusk} tz={tz} />
            <Row label="Astronomical dusk" at={night.astronomicalDusk} tz={tz} />
            <Row label="Astronomical dawn" at={night.astronomicalDawn} tz={tz} />
            <Row label="Sunrise" at={night.sunrise} tz={tz} />
            <tr>
              <th scope="row">Moon</th>
              <td>
                {Math.round(night.moonIllumination * 100)}% lit
                {night.moonrise ? `, rises ${formatTime(night.moonrise, tz)}` : ''}
                {night.moonset ? `, sets ${formatTime(night.moonset, tz)}` : ''}
              </td>
            </tr>
            <tr>
              <th scope="row">Dark windows</th>
              <td>
                {night.darkWindows.length === 0
                  ? '—'
                  : night.darkWindows
                      .map(([s, e]) => `${formatTime(s, tz)}–${formatTime(e, tz)}`)
                      .join(', ')}
              </td>
            </tr>
          </tbody>
        </table>
        {night.darknessNote && <p className="night-plan-note">{night.darknessNote}</p>}
      </section>

      <section>
        <h2>Worth going outside for</h2>
        {events.length === 0 ? (
          <p>Nothing unusual tonight.</p>
        ) : (
          <ol className="night-plan-events">
            {events.map((event) => (
              <li key={event.id}>
                <p className="night-plan-event-head">
                  <strong>{event.title}</strong>
                  <span>
                    {formatTime(event.peak, tz)} · {Math.round(event.bestAltitude)}° up,{' '}
                    {compassPoint(event.bestAzimuth)} · {EQUIPMENT_LABEL[event.equipment]} · score {event.score}
                  </span>
                </p>
                <p>{event.detail}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <footer>
        <p>
          Sidereal · positions computed for this location and date · star and deep-sky data from HYG,
          Stellarium, OpenNGC and the IMO working list
        </p>
      </footer>
    </article>
  );
}

function Row({ label, at, tz }: { label: string; at: number | null; tz: string }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{at == null ? '—' : formatTime(at, tz)}</td>
    </tr>
  );
}
