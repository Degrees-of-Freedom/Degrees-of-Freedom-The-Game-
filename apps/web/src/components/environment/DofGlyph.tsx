/** Axis artwork used by the prototype's six-DOF connection card. */
export function DofGlyph({ axis, locked }: { axis: number; locked: boolean }) {
  const color = ["#d9604e", "#5fa36a", "#4d86c4"][axis % 3];
  return (
    <svg
      viewBox="0 0 36 30"
      aria-hidden="true"
      style={{ color: locked ? "#c2c9d3" : color }}
    >
      {axis < 3 ? (
        <g transform={`rotate(${[0, -35, -90][axis]},18,15)`}>
          <path
            d="M5 15h26M10 10l-5 5 5 5M26 10l5 5-5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      ) : (
        <g>
          <path
            d="M9 20a10 10 0 1 1 17-9M22 6l5 5 3-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M18 9v14" stroke="currentColor" opacity=".45" />
        </g>
      )}
      {locked && (
        <g transform="translate(12,9)">
          <rect x="0" y="5" width="12" height="10" rx="2" fill="#fbf7ef" />
          <path
            d="M3 5V2a3 3 0 0 1 6 0v3"
            fill="none"
            stroke="#fbf7ef"
            strokeWidth="2"
          />
          <circle cx="6" cy="9" r="1.4" fill="#3f4654" />
        </g>
      )}
    </svg>
  );
}
