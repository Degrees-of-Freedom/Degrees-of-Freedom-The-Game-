import { describePrinting, physicalCatalogue, type CardDefinition } from '../game/cardCatalogue';
import { ITEMS } from '../solver/voxelSections';

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
      <small>{card.definitionId} · {card.definitionVersion}</small>
    </details>
  );
}
