/** Transport-bar glyphs, drawn on a 24x24 grid so they optically match. */

const svgProps = {
  viewBox: '0 0 24 24',
  width: 22,
  height: 22,
  fill: 'currentColor',
  'aria-hidden': true,
  focusable: false,
} as const;

export function IconSkipStart() {
  return (
    <svg {...svgProps}>
      <rect x="4.5" y="5" width="2.4" height="14" rx="0.6" />
      <path d="M19 5v14L8.8 12z" />
    </svg>
  );
}

export function IconStepBack() {
  return (
    <svg {...svgProps}>
      <path d="M15 5v14L5.4 12z" />
      <rect x="16.6" y="5" width="2.4" height="14" rx="0.6" />
    </svg>
  );
}

export function IconStepForward() {
  return (
    <svg {...svgProps}>
      <rect x="5" y="5" width="2.4" height="14" rx="0.6" />
      <path d="M9 5v14l9.6-7z" />
    </svg>
  );
}

export function IconSkipEnd() {
  return (
    <svg {...svgProps}>
      <path d="M5 5v14l10.2-7z" />
      <rect x="17.1" y="5" width="2.4" height="14" rx="0.6" />
    </svg>
  );
}

export function IconPlay() {
  return (
    <svg {...svgProps}>
      <path d="M7 4v16l13-8z" />
    </svg>
  );
}

export function IconPause() {
  return (
    <svg {...svgProps}>
      <rect x="7" y="4" width="3.6" height="16" rx="0.6" />
      <rect x="13.4" y="4" width="3.6" height="16" rx="0.6" />
    </svg>
  );
}

export function IconRestart() {
  return (
    <svg {...svgProps}>
      {/* clockwise loop, open at the top-left where the arrowhead sits */}
      <path
        d="M12 5.4a6.6 6.6 0 1 1-6.6 6.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path d="M10.6 1.9v7l4.9-3.5z" />
    </svg>
  );
}
