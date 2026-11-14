import { describe, expect, it } from 'vitest';
import { analyzeTurn, toTurnVoxelInput } from './turnAnalysis';
import { activeTurnHand, createTurnGame, stageElement, stageLoad } from './turns';

describe('Shared table structural simulation', () => {
  it('analyzes the fixed setup and transfers a staged load to the other foundation', () => {
    let turn = createTurnGame();
    for (let seed = 2; !activeTurnHand(turn).some((card) => card.kind === 'load'); seed++) turn = createTurnGame(seed);
    const baseline = analyzeTurn(turn);
    expect(baseline.error).toBeUndefined();
    expect(baseline.mechanism).toBe(false);
    const card = activeTurnHand(turn).find((card) => card.kind === 'load');
    if (!card) throw new Error('Expected load card');
    const loaded = stageLoad(turn, card.id, '5,3,1');
    if (!loaded.ok) throw new Error(loaded.reason);
    const result = analyzeTurn(loaded.state);
    expect(result.mechanism).toBe(false);
    expect(result.combos[0].reac).toBeDefined();
    const ctx = result.ctx!;
    const a = ctx.aid[ctx.idx.get('5,3,0')!];
    expect(result.combos[0].reac![a][2] - baseline.combos[0].reac![a][2]).toBeCloseTo(card.magnitude);
  });

  it('keeps an unattached coincident member out of the supported component', () => {
    let turn = createTurnGame();
    for (let seed = 2; !activeTurnHand(turn).some((card) => card.kind === 'element'); seed++) turn = createTurnGame(seed);
    const card = activeTurnHand(turn).find((card) => card.kind === 'element');
    if (!card) throw new Error('Expected element card');
    const placed = stageElement(turn, card.id, '1,3,1', '1,3,2');
    if (!placed.ok) throw new Error(placed.reason);
    const memberId = placed.state.draft.members[0].id;
    const input = toTurnVoxelInput(placed.state);
    const end = `endpoint:${memberId}:a`;
    expect(input.positions?.[end]).toEqual([1, 3, 1]);
    expect(input.members.at(-1)?.a).toBe(end);
    const result = analyzeTurn(placed.state);
    expect(result.floating).toEqual([`endpoint:${memberId}:a`, `endpoint:${memberId}:b`]);
    expect(result.members[memberId]).toBeUndefined();
    expect(result.members[1]).toBeDefined();
  });

  it('releases ball moments without a singular double-ball rotational recovery', () => {
    const turn = createTurnGame();
    const member = turn.board.members[0];
    turn.board.connections.find((item) => item.memberId === member.id && item.end === 'b')!.profile = 'ball';
    const singleBall = analyzeTurn(turn);
    const force = singleBall.combos[0].ef?.get(singleBall.members[member.id].e)?.f;
    expect(force?.slice(9)).toEqual(new Float64Array(3));
    turn.board.connections.find((item) => item.memberId === member.id && item.end === 'a')!.profile = 'ball';
    const result = analyzeTurn(turn);
    expect(result.mechanism).toBe(true);
    expect(result.combos.every((combo) => combo.fail)).toBe(true);
  });
});

