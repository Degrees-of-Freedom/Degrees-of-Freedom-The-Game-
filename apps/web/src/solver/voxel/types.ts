/** Types of the legacy voxel frame kernel. Its elements and numbering extend
 * the evaluator's shared geometry with stiffness and equation numbers. */
import type { FrameConnection } from '../../evaluator/connections';
import type { Context as GeometryContext, Element as GeometryElement, ElementForce, StructureEvaluation } from '../../evaluator/results';
import type { ConnectionReduction } from './frameConnections';
export type { Combo, ComponentResponse, Demand, ElementForce, LoadCombo } from '../../evaluator/results';
export { displacementAt } from '../../evaluator/results';

export type Element = GeometryElement & {
  k: Float64Array;
  rel: number[];
  kgl: Float64Array;
  dofs: number[];
  connector?: { ends: [FrameConnection, FrameConnection]; reduction: ConnectionReduction };
};
export type Context = Omit<GeometryContext, 'els'> & {
  eq: Int32Array;
  nf: number;
  els: Element[];
  bw: number;
};
export type FrameSystem = Pick<Context, 'nf' | 'NA' | 'eq' | 'els' | 'bw'>;
export type Solved = {
  u: Float64Array;
  K0: Float64Array;
  activeDofs: number[];
  active: Map<Element, boolean>;
  ef: Map<Element, ElementForce>;
};
/** A legacy kernel analysis keeps its stiffness numbering on `ctx`. */
export type VoxelAnalysis = Omit<StructureEvaluation, 'ctx'> & { ctx?: Context };
