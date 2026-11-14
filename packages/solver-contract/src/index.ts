export type Vector3 = readonly [number, number, number];
export interface StructuralNode { id: string; position: Vector3 }
export interface StructuralMember { id: string; startNodeId: string; endNodeId: string }
/** Global translations X/Y/Z followed by rotations X/Y/Z. */
export type DegreesOfFreedom = readonly [boolean, boolean, boolean, boolean, boolean, boolean];
export interface StructuralSupport { nodeId: string; restrained: DegreesOfFreedom }
export interface StructuralLoad { nodeId: string; force: Vector3; moment: Vector3 }
export interface StructuralModel { units: 'SI'; nodes: StructuralNode[]; members: StructuralMember[]; supports: StructuralSupport[]; loads: StructuralLoad[] }
export type AnalysisResult = { status: 'success'; displacements: Record<string, readonly [number, number, number, number, number, number]>; warnings: string[] } | { status: 'unsupported' | 'error'; message: string };
/** Adapters translate models to their solver and explicitly report unsupported input. */
export interface SolverAdapter { readonly id: string; readonly name: string; analyze(model: StructuralModel, signal?: AbortSignal): Promise<AnalysisResult> }
