import { describe, expect, it } from 'vitest';
import { bayEdges } from './bay';
import { bayBraceCandidates } from './bayBrace';
import { nodeKey, type GameModel } from './model';

describe('bay panel diagonals', () => {
  it('finds both diagonals on each completed face', () => {
    const members = bayEdges([0, 0, 0], [2, 2, 2]).map(([a, b], index) => ({
      a: nodeKey(...a), b: nodeKey(...b), type: 'shs' as const, id: index + 1,
    }));
    const model: GameModel = { members, attrs: {}, nextId: 13 };
    expect(bayBraceCandidates(model, [2, 2, 2])).toHaveLength(12);
    const incomplete = { ...model, members: members.slice(1) };
    expect(bayBraceCandidates(incomplete, [2, 2, 2])).toHaveLength(8);
    const braced = { ...model, members: [...members, { a: '0,0,0', b: '2,2,0', id: 13, type: 'shs' as const }] };
    expect(bayBraceCandidates(braced, [2, 2, 2])).toHaveLength(11);
  });
});
