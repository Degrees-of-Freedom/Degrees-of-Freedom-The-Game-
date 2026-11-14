import type { DegreesOfFreedom, MemberEndFixity, StructuralMember, StructuralModel, StructuralNode } from '@dof/solver-contract';

/**
 * Ready-made structures for trying the analysis before building tools exist.
 *
 * All three share one geometry: a 4 m cube frame on four pin supports, with a
 * sideways and downward load on each top corner. They differ only in bracing
 * and connection type, which is what decides stability. Y is up, matching the
 * viewer's ground grid.
 */
export interface ExampleStructure {
  id: string;
  name: string;
  description: string;
  build: () => StructuralModel;
}

const HALF_WIDTH = 2;
const HEIGHT = 4;
const PIN_SUPPORT: DegreesOfFreedom = [true, true, true, false, false, false];
const CORNERS: ReadonlyArray<readonly [number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

function cubeFrame(fixity: MemberEndFixity, braced: boolean): StructuralModel {
  const nodes: StructuralNode[] = [];
  const members: StructuralMember[] = [];
  const member = (startNodeId: string, endNodeId: string, ends: MemberEndFixity = fixity) =>
    members.push({ id: `${startNodeId}-${endNodeId}`, startNodeId, endNodeId, startFixity: ends, endFixity: ends });

  CORNERS.forEach(([x, z], i) => {
    nodes.push({ id: `base${i}`, position: [x * HALF_WIDTH, 0, z * HALF_WIDTH] });
    nodes.push({ id: `top${i}`, position: [x * HALF_WIDTH, HEIGHT, z * HALF_WIDTH] });
  });
  CORNERS.forEach((_, i) => {
    const next = (i + 1) % CORNERS.length;
    member(`base${i}`, `top${i}`);
    member(`top${i}`, `top${next}`);
    // One diagonal per face, running the same way round, braces every direction.
    if (braced) member(`base${i}`, `top${next}`, 'pinned');
  });

  return {
    units: 'SI',
    nodes,
    members,
    supports: CORNERS.map((_, i) => ({ nodeId: `base${i}`, restrained: PIN_SUPPORT })),
    loads: CORNERS.map((_, i) => ({ nodeId: `top${i}`, force: [4e3, -25e3, 0], moment: [0, 0, 0] })),
  };
}

export const EXAMPLES: readonly ExampleStructure[] = [
  {
    id: 'braced-truss',
    name: 'Braced truss',
    description: 'Pinned joints, a diagonal in every face',
    build: () => cubeFrame('pinned', true),
  },
  {
    id: 'unbraced-pinned',
    name: 'Unbraced frame',
    description: 'Pinned joints, no diagonals',
    build: () => cubeFrame('pinned', false),
  },
  {
    id: 'rigid-frame',
    name: 'Rigid frame',
    description: 'Moment connections, no diagonals',
    build: () => cubeFrame('fixed', false),
  },
];
