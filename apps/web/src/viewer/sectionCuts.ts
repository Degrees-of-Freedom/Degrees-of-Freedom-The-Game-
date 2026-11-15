import type { VoxelAnalysis } from "../solver/voxelResults";
import { verifiedResponse } from "../solver/voxelVerification";

export const cutActions = ["Axial N", "Shear Vy", "Shear Vz", "Torsion T", "Moment My", "Moment Mz"] as const;
export interface CutSeries {
  key: string;
  part?: string;
  axialOnly: boolean;
  reason?: string;
  cuts: { at: number; forces: readonly number[] }[];
}

/** Preserve both physical cuts at the same station. A branch load can make
 * shear jump there, and averaging would erase its magnitude and sign. */
export function sectionCuts(result: VoxelAnalysis, parent: number): CutSeries[] {
  const combo = result.combos[0];
  return (result.ctx?.els ?? []).filter(e => (e.m.parentSpan?.memberId ?? e.m.id) === parent).map(e => {
    const span = e.m.parentSpan, part = span?.assemblyPart;
    const start = part ? 0 : (span?.fromQuarter ?? 0)/4;
    const finish = part ? 1 : (span?.toQuarter ?? 4)/4;
    const scope = combo?.components?.find(c => c.memberIds.includes(e.m.id));
    const response = combo?.ef?.get(e);
    const base = { key: String(e.m.id), part, axialOnly: e.it.kind !== "beam" };
    if (!response || scope?.status !== "computed" || !verifiedResponse(scope.verification)) {
      return { ...base, cuts: [], reason: scope?.reason ?? "Member response unavailable." };
    }
    if (base.axialOnly) {
      const axialKN = response.cableTension ?? response.f[6];
      return Number.isFinite(axialKN)
        ? { ...base, cuts: [{ at: start, forces: [axialKN] }, { at: finish, forces: [axialKN] }] }
        : { ...base, cuts: [], reason: "Axial response unavailable." };
    }
    const stations = response.stations;
    if (!stations?.length || stations.some(s => !Number.isFinite(s.fraction) || s.forces.length !== 6 || s.forces.some(f => !Number.isFinite(f)))) {
      return { ...base, cuts: [], reason: "No verified section cuts for this span." };
    }
    return { ...base, cuts: stations.map(cut => ({ at: start + cut.fraction * (finish - start), forces: cut.forces })) };
  }).sort((a, b) => (a.cuts[0]?.at ?? 0) - (b.cuts[0]?.at ?? 0));
}
