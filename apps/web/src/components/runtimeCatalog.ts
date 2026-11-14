import type { GameMode, PresentationStyle } from '../game/modes';
export const MODE_CATALOG: { id: GameMode; title: string; subtitle: string; description: string; style: PresentationStyle }[] = [
  { id: 'creative', title: 'Creative', subtitle: 'A place to explore', description: 'Build freely, connect joints and add gravity loads. Follow the forces through your structure.', style: 'grow' },
  { id: 'challenge', title: 'Engineering challenges', subtitle: 'Build with purpose', description: 'Towers, bridges and suspended weights. Work with a supply, a budget and structural objectives.', style: 'engineering' },
  { id: 'forensics', title: 'Forensics', subtitle: 'Find the missing connection', description: 'Inspect a prepared structure, repair its weaknesses and check your solution.', style: 'levels' },
  { id: 'load-space', title: 'Load in space', subtitle: 'Make a path to the ground', description: 'Reach a suspended weight from the foundation. Build a structure that carries it.', style: 'grow-dusk' },
  { id: 'multiplayer', title: 'Shared table', subtitle: 'Two players. One structure.', description: 'A local playtest with two decks, persistent gravity loads and individual end connections.', style: 'kit' },
];
export const STYLE_CATALOG: { id: PresentationStyle; title: string; description: string }[] = [
  { id: 'grow', title: 'Grow', description: 'Reach from joint to joint in an open diorama.' },
  { id: 'grow-dusk', title: 'Grow · dusk', description: 'The same growing structure in evening light.' },
  { id: 'levels', title: 'Levels', description: 'Work precisely on one elevation at a time.' },
  { id: 'blocks', title: 'Blocks', description: 'Stack structural bays, then refine their frame.' },
  { id: 'kit', title: 'Kit', description: 'A tabletop view of your shared construction.' },
  { id: 'engineering', title: 'Engineering', description: 'The full structural workspace and analysis tools.' },
];
