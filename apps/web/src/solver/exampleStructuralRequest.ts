/** Small explicit OpenSees-profile example; properties are not game defaults. */
export const exampleStructuralRequest = {
  requestVersion: 1,
  snapshot: {
    format: 'dof-structural-state', schemaVersion: 1, modelId: 'example-cantilever', revisionId: '1',
    units: 'SI', globalAxes: 'right-handed-z-up',
    materials: [{ id: 'steel', elasticModulus: 210e9, shearModulus: 81e9 }],
    sections: [{ id: 'opensees-section', area: 7.49e-3, iy: 4.47e-5, iz: 4.47e-5, torsionConstant: 7.03e-5, capacities: [] }],
    joints: [{ id: 'base', position: [0, 0, 0] }],
    members: [{ id: 'column', family: 'frame', start: { id: 'base-end', position: [0, 0, 0] }, end: { id: 'tip-end', position: [0, 0, 2] }, referenceY: [0, 1, 0], state: 'active', materialId: 'steel', sectionId: 'opensees-section' }],
    connections: [{ id: 'base-connection', endpointId: 'base-end', jointId: 'base', referenceY: [0, 1, 0], laws: Array.from({ length: 6 }, () => ({ kind: 'locked' })), capacities: [], state: 'active' }],
    foundations: [{ id: 'foundation', jointId: 'base', restrained: [true, true, true, true, true, true] }],
    loads: [{ id: 'tip-load', target: { kind: 'endpoint', id: 'tip-end' }, force: [1000, 0, 0], moment: [0, 0, 0], persistent: true }],
    loadCases: [{ id: 'case', loads: [{ loadId: 'tip-load', factor: 1 }] }], selfWeight: { enabled: false },
  },
  analysis: { kind: 'linear-static', loadPath: [{ selfWeightFactor: 0, factors: [{ caseId: 'case', factor: 1 }] }] },
};
