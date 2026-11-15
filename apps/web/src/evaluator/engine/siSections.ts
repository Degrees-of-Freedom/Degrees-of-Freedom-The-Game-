/** Card sections in the Rust solver's SI units. */
import type { AnalysisSection } from '@dof/solver-contract';
import type { EvaluatorMemberType } from '../model';
import { ITEMS } from '../sections';

/** The game stores forces in kN and stiffness in kN/m²; the solver uses SI. */
export const SI_PER_KILO = 1e3;
/** Standard gravity, m/s², acting along −Z (the game's vertical axis). */
export const GRAVITY = 9.81;

/**
 * Card properties of one member type in the solver's units.
 *
 * Strengths become capacities: axial from the area, bending from the section
 * moduli, shear from the smaller shear area, a cable from its design
 * resistance. Self-weight per metre becomes a density, so that the solver's
 * own self-weight reproduces the card's weight.
 */
export function sectionFor(type: EvaluatorMemberType): AnalysisSection {
  const item = ITEMS[type];
  if (item.kind === 'spring') throw new Error('Spring members are not supported by the detailed solver translation.');
  const density = (item.w * SI_PER_KILO) / (item.A * GRAVITY);
  if (item.kind === 'cable')
    return {
      id: type,
      E: item.E * SI_PER_KILO,
      A: item.A,
      density,
      capacity: { tension: item.NRd * SI_PER_KILO },
    };
  return {
    id: type,
    E: item.E * SI_PER_KILO,
    G: item.G * SI_PER_KILO,
    A: item.A,
    Iy: item.Iy,
    Iz: item.Iz,
    J: item.J,
    shearAreaY: item.Avy,
    shearAreaZ: item.Avz,
    density,
    capacity: {
      tension: item.ft * item.A * SI_PER_KILO,
      compression: item.fc * item.A * SI_PER_KILO,
      momentY: item.fm * item.Wy * SI_PER_KILO,
      momentZ: item.fm * item.Wz * SI_PER_KILO,
      shear: item.fv * Math.min(item.Avy, item.Avz) * SI_PER_KILO,
    },
  };
}
