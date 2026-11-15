/**
 * Number formatting for board labels and legends. Magnitudes below
 * {@link NEGLIGIBLE} are solver round-off on an unloaded board, so they read
 * as zero instead of "0.000000001". This only affects display text.
 */
export const NEGLIGIBLE = 1e-6;

export const isNegligible = (value: number | undefined) => !value || !Number.isFinite(value) || Math.abs(value) < NEGLIGIBLE;

/** Three significant figures with thousands separators, e.g. 1,230 or 0.0123. */
export function formatValue(value: number): string {
  if (isNegligible(value)) return "0";
  return Number(value.toPrecision(3)).toLocaleString("en", { maximumSignificantDigits: 3 });
}

/** Signed form with a true minus sign, e.g. "−12.4". */
export const formatSigned = (value: number) => (isNegligible(value) || value > 0 ? "" : "−") + formatValue(Math.abs(value));
