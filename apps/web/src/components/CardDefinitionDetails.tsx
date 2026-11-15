import { describePrinting, physicalCatalogue, type CardDefinition } from '../game/cardCatalogue';
import { ITEMS } from '../evaluator/sections';
import { CARD_STRENGTH } from '../evaluator/capacity';

/** Inspect the same immutable printing used to generate this card's rules. */
export function CardDefinitionDetails({ card }: { card: CardDefinition }) {
  const section = card.kind === 'element' ? ITEMS[card.type] : null;
  const geometry = card.kind === 'element' ? physicalCatalogue.geometry[card.type] : null;
  const rating = card.kind === 'connection' ? CARD_STRENGTH.connections[card.profile] : null;
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
      {rating && (
        <p>{'moment' in rating
          ? `Interaction limits ${rating.force} kN resultant force and ${rating.moment} kN·m resultant moment (elliptic interaction).`
          : `Resultant force limit ${rating.force} kN. Rotations are released.`}</p>
      )}
      {card.kind === 'element' && card.type !== 'cable' && card.type !== 'spring' && section?.kind === 'beam' && (
        <p>Printed tensile / compressive / bending / shear strengths {section.ft / 1000} / {section.fc / 1000} / {section.fm / 1000} / {section.fv / 1000} MPa.
          {' '}Torsion limit {CARD_STRENGTH.torsion[card.type]} kN·m · {CARD_STRENGTH.version}.</p>
      )}
      <small>{card.definitionId} · {card.definitionVersion}</small>
    </details>
  );
}
