import { describePrinting, physicalCatalogue, type CardDefinition } from '../game/cardCatalogue';
import { ITEMS } from '../solver/voxelSections';
import { CARD_STRENGTH } from '../solver/voxelCapacity';

/** Inspect the same immutable printing used to generate this card's rules. */
export function CardDefinitionDetails({ card }: { card: CardDefinition }) {
  const section = card.kind === 'element' ? ITEMS[card.type] : null;
  const geometry = card.kind === 'element' ? physicalCatalogue.geometry[card.type] : null;
  return (
    <details>
      <summary>Printed card properties</summary>
      <p>{describePrinting(card)}</p>
      {geometry && (
        <p>{Object.entries(geometry).filter(([key]) => key !== 'kind').map(([key, value]) =>
          `${key} ${Number((Number(value) * 1000).toFixed(3))} mm`).join(' · ')}</p>
      )}
      {section?.kind === 'beam' && (
        <p>Iy {section.Iy} m⁴ · Iz {section.Iz} m⁴ · J {section.J} m⁴.
          {' '}Component equilibrium and the small-displacement checks determine whether a reaction can count.</p>
      )}
      {card.kind === 'connection' && (
        <p>{card.profile === 'ball'
          ? `Resultant force limit ${CARD_STRENGTH.connections.ball.force} kN. Rotations are released.`
          : `Interaction limits ${CARD_STRENGTH.connections.fixed.force} kN resultant force and ${CARD_STRENGTH.connections.fixed.moment} kN·m resultant moment (elliptic interaction).`}</p>
      )}
      {card.kind === 'element' && card.type !== 'cable' && card.type !== 'spring' && section?.kind === 'beam' && (
        <p>Printed tensile / compressive / bending / shear strengths {section.ft / 1000} / {section.fc / 1000} / {section.fm / 1000} / {section.fv / 1000} MPa.
          {' '}Torsion limit {CARD_STRENGTH.torsion[card.type]} kN·m · {CARD_STRENGTH.version}.</p>
      )}
      <small>{card.definitionId} · {card.definitionVersion}</small>
    </details>
  );
}
