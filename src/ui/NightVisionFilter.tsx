/**
 * Red-light mode (the §14.1 decision).
 *
 * Rather than maintaining a second palette, the whole app is passed through an
 * SVG colour matrix that collapses every channel onto red. That covers the
 * canvas as well as the DOM, which a CSS-variable swap would not, and it is
 * honest about what red-light mode is for: keeping the observer's rod cells
 * dark-adapted while they look at a screen.
 */
export function NightVisionFilter() {
  return (
    <svg className="visually-hidden" aria-hidden="true" focusable="false">
      <filter id="sidereal-night-vision" colorInterpolationFilters="sRGB">
        <feColorMatrix
          type="matrix"
          values="
            0.35 0.68 0.13 0 0
            0    0    0    0 0
            0    0    0    0 0
            0    0    0    1 0"
        />
      </filter>
    </svg>
  );
}
