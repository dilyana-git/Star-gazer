/** What you tapped on. */
import { compassPoint } from '../astro/frames';
import { KIND_LABEL, type SkyObject } from '../astro/objects';
import { useStore } from '../state/store';

export function DetailCard({ target }: { target: SkyObject }) {
  const select = useStore((s) => s.select);
  const lookAt = useStore((s) => s.lookAt);

  const below = target.altitude < 0;

  return (
    <aside className="detail-card" role="dialog" aria-label={target.name}>
      <button type="button" className="detail-close" onClick={() => select(null)} aria-label="Close">
        ×
      </button>

      <p className="detail-kind">{KIND_LABEL[target.kind]}</p>
      <h2>{target.name}</h2>
      <p className="detail-body">{target.detail}</p>

      <dl className="detail-figures mono">
        <div>
          <dt>Altitude</dt>
          <dd>{target.altitude.toFixed(1)}°</dd>
        </div>
        <div>
          <dt>Azimuth</dt>
          <dd>{target.azimuth.toFixed(1)}°</dd>
        </div>
        <div>
          <dt>Direction</dt>
          <dd>{compassPoint(target.azimuth)}</dd>
        </div>
      </dl>

      <p className="detail-where">
        {below
          ? 'Below the horizon right now — scrub the ribbon to find it.'
          : `Look ${compassPoint(target.azimuth)}, ${Math.round(target.altitude)}° above the horizon.`}
      </p>

      <button
        type="button"
        className="detail-action"
        onClick={() => lookAt(target.altitude, target.azimuth, 20)}
      >
        Centre the view on it
      </button>
    </aside>
  );
}
