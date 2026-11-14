import { create } from 'zustand';
import type { StructuralModel } from '@dof/solver-contract';
const emptyModel = (): StructuralModel => ({ units: 'SI', nodes: [], members: [], supports: [], loads: [] });
interface GameState { model: StructuralModel; reset: () => void }
/** Game state remains independent of the renderer and solver implementation. */
export const useGameStore = create<GameState>((set) => ({ model: emptyModel(), reset: () => set({ model: emptyModel() }) }));
