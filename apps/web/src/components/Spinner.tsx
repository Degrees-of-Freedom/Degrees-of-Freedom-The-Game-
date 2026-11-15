import './spinner.css';

/** Compact progress indicator with an accessible description. */
export function Spinner({ label }: { label: string }) {
  return <span className="loading-spinner" role="status" aria-label={label} />;
}
