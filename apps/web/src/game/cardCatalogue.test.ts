import { describe, expect, it } from 'vitest';
import { ITEMS, resolveMemberLaw, SECTION_GEOMETRY } from '../solver/voxelSections';
import { activeTurnHand, createTurnGame, parseTurnState, stageElement } from './turns';
import {
  CARD_DEFINITION_VERSION, CANDIDATE_FAMILIES, describePrinting, LEGACY_CATALOGUE,
  memberDeckTypes, printedCards, resolveCardDefinition, SCORED_CATALOGUE,
} from './cardCatalogue';

describe('versioned physical printings', () => {
  it('resolves every dealt card against an immutable printing and restores the exact chosen deck', () => {
    for (const catalogue of [LEGACY_CATALOGUE, SCORED_CATALOGUE]) {
      const original = createTurnGame(5, catalogue);
      const instances = [...original.decks.flat(), ...activeTurnHand(original)];
      expect(new Set(instances.map(card => card.id)).size).toBe(96);
      for (const { id, ...printing } of instances) {
        expect(resolveCardDefinition(printing.definitionId, printing.definitionVersion)).toEqual(printing);
        expect(id).not.toBe(printing.definitionId);
      }
      const member = activeTurnHand(original).find(card => card.kind === 'element')!;
      const stage = stageElement(original, member.id, '2,2,1', '2,2,2');
      if (!stage.ok) throw new Error(stage.reason);
      const restored = parseTurnState(JSON.parse(JSON.stringify({
        version: 1, catalogue, seed: 5, events: stage.state.events,
      })));
      expect(restored).toEqual(stage.state);
    }
    expect(parseTurnState({ version: 1, seed: 5, events: [] })).toEqual(createTurnGame(5, LEGACY_CATALOGUE));
    expect(parseTurnState({ version: 1, catalogue: 'unrecognized', seed: 5, events: [] })).toBeNull();
    expect(() => resolveCardDefinition('gravity/5kN', 'future')).toThrow(/Unsupported/);
    expect(() => resolveCardDefinition('candidate/spring', CARD_DEFINITION_VERSION)).toThrow(/Unsupported/);
  });

  it('keeps unvalidated families out of the scored deck and prints the actual per-axis reach', () => {
    const reaches = new Map<string, Set<number>>();
    for (let i = 0; i < 32; i++) {
      const card = printedCards(i, SCORED_CATALOGUE).element;
      if (card.kind !== 'element') throw new Error('Wrong card definition family');
      expect(describePrinting(card)).toContain(`${card.maxSteps * 2} m on each grid axis`);
      if (!reaches.has(card.type)) reaches.set(card.type, new Set());
      reaches.get(card.type)!.add(card.maxSteps);
    }
    expect([...reaches.keys()]).toEqual(memberDeckTypes(SCORED_CATALOGUE));
    expect(reaches.has('cable')).toBe(false);
    for (const variants of reaches.values()) expect(variants).toEqual(new Set([1, 2, 3, 4]));
    expect(memberDeckTypes(LEGACY_CATALOGUE)).toContain('cable');
    expect(Object.values(CANDIDATE_FAMILIES).every(def => def.capability === 'candidate')).toBe(true);
  });

  it('uses consistent SI moduli, section axes and finite cable rest state at the analytical boundary', () => {
    for (const type of ['shs', 'glulam', 'ipe', 'heb'] as const) {
      const section = ITEMS[type];
      expect(resolveMemberLaw(type, 6)).toEqual({
        kind: 'frame', area: section.A, elasticModulus: section.E * 1000, shearModulus: section.G * 1000,
        iy: section.Iy, iz: section.Iz, torsionConstant: section.J,
      });
      expect(SECTION_GEOMETRY[type].width).toBe(section.dim[0]);
      expect(SECTION_GEOMETRY[type].depth).toBe(section.dim[1]);
    }
    const geometry = SECTION_GEOMETRY.shs;
    expect(geometry.width - 2 * geometry.wall).toBeCloseTo(0.088);
    for (const section of [SECTION_GEOMETRY.ipe, SECTION_GEOMETRY.heb]) {
      expect(section.web).toBeLessThan(section.width);
      expect(2 * section.flange).toBeLessThan(section.depth);
    }
    for (const referenceLength of [1, Math.sqrt(12), 13]) {
      const cable = resolveMemberLaw('cable', referenceLength);
      if (cable.kind !== 'cable') throw new Error('Missing cable constitutive law');
      const prestressForce = cable.elasticModulus * cable.area * (referenceLength / cable.restLength - 1);
      expect(prestressForce).toBeCloseTo(25000, 7);
    }
    expect(() => resolveMemberLaw('cable', 0)).toThrow(/positive/);
    expect(() => resolveMemberLaw('ipe', NaN)).toThrow(/finite/);
  });
});
