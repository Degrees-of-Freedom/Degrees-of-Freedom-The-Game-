import type { PublicRepairReport } from "../game/publicRepairReport";

/** Count the acting player's distinct committed charges through this report.
 * This projection works after resume without storing or replaying a cue. */
type ChargeReport = Pick<PublicRepairReport, "turn" | "playerId" | "charge">;
export function mistakeCount(reports: readonly ChargeReport[], latest: ChargeReport) {
  if (!latest.charge) return 0;
  return new Set(reports.filter(report => report.playerId === latest.playerId && report.turn <= latest.turn)
    .flatMap(report => report.charge ? [report.charge.id] : [])).size;
}

/** A batch can settle both seats' earlier turns together. Surface the highest
 * priority new finding once, retaining its original player and turn. */
export function checkpointNotice<T extends ChargeReport>(reports: readonly T[], firstTurn: number) {
  const newestFirst = reports.filter(report => report.turn >= firstTurn).reverse();
  return newestFirst.find(report => {
    const count = mistakeCount(reports, report);
    return count > 0 && count % 3 === 0;
  }) ?? newestFirst.find(report => report.charge?.unstableMemberId !== undefined) ?? newestFirst[0];
}

const cooldown = 45_000;
const cooldownKey = "dof.companion.foremanAt";
let lastForeman = -Infinity;

/** Cooldown is cosmetic, shared across board remounts. Storage contains one
 * timestamp only and is optional when browser storage is unavailable. */
export function takeForemanCue(count: number, now = performance.timeOrigin + performance.now()) {
  if (count <= 0 || count % 3 !== 0) return false;
  try {
    const saved = sessionStorage.getItem(cooldownKey);
    if (saved && Number.isFinite(Number(saved)) && Number(saved) <= now) lastForeman = Math.max(lastForeman, Number(saved));
  } catch { /* In-memory cooldown still applies. */ }
  if (now - lastForeman < cooldown) return false;
  lastForeman = now;
  try { sessionStorage.setItem(cooldownKey, String(now)); } catch { /* Optional. */ }
  return true;
}
