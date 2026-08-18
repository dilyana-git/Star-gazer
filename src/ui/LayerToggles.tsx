/** Layer switches for the sky, and the reset for the view. */
import { useStore } from '../state/store';
import type { SkyLayers } from '../render/sky';

const LAYERS: Array<[keyof SkyLayers, string]> = [
  ['constellationLines', 'Figures'],
  ['boundaries', 'Boundaries'],
  ['labels', 'Labels'],
  ['dsos', 'Deep sky'],
  ['ecliptic', 'Ecliptic'],
  ['milkyWay', 'Milky Way'],
];

export function LayerToggles() {
  const layers = useStore((s) => s.layers);
  const toggleLayer = useStore((s) => s.toggleLayer);
  const view = useStore((s) => s.view);
  const resetView = useStore((s) => s.resetView);

  const zoomed = view.fieldRadius < 89.5 || view.centreAltitude < 89.5;

  return (
    <div className="layers">
      {LAYERS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          className={`layer-toggle${layers[key] ? ' is-on' : ''}`}
          aria-pressed={layers[key]}
          onClick={() => toggleLayer(key)}
        >
          {label}
        </button>
      ))}
      {zoomed && (
        <button type="button" className="layer-toggle layer-reset" onClick={resetView}>
          Whole sky
        </button>
      )}
    </div>
  );
}
