interface Props {
  /** Pixel size of the square logo. Tailwind classes are used so any standard size works. */
  className?: string;
  /** When true, render the chart icon without the rounded blue background — useful for inverted contexts. */
  bare?: boolean;
}

/**
 * Brand mark for Portfolio Tracker: an upward-trending chart line inside a rounded brand-blue square.
 * Mirrors the SVG used as the page favicon so the icon stays consistent across browser tab and UI.
 */
export default function BrandLogo({ className = 'h-8 w-8', bare = false }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Portfolio Tracker"
    >
      {!bare && <rect width="64" height="64" rx="12" fill="#2563eb" />}
      <path
        d="M12 46 L26 32 L34 38 L52 18"
        stroke={bare ? '#2563eb' : '#ffffff'}
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M40 18 L52 18 L52 30"
        stroke={bare ? '#2563eb' : '#ffffff'}
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
