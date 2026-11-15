"""Quality-diversity archive (MAP-Elites style) of verified structures.

Cells are indexed by three behaviour descriptors (curvature, dynamism and
complexity, four bins each). Each cell keeps only its fittest *passing*
structure, so the discriminator's "real" set is both safe and varied, and a
better structure in a cell replaces its predecessor (a ratchet on quality).
"""

from __future__ import annotations

import numpy as np

from .evaluation import Evaluation
from .lattice import Structure
from .metrics import shape_similarity

BINS = 4
Cell = tuple[int, int, int]


def cell_of(evaluation: Evaluation) -> Cell:
    a = evaluation.aesthetics
    if a is None:
        raise ValueError("Only evaluated, passing structures have a behaviour cell.")
    return tuple(min(BINS - 1, int(v * BINS)) for v in (a.curvature, a.dynamism, a.complexity))  # type: ignore[return-value]


class Archive:
    def __init__(self) -> None:
        self._cells: dict[Cell, Evaluation] = {}
        self._keys: set[str] = set()

    def __len__(self) -> int:
        return len(self._cells)

    @property
    def elites(self) -> list[Evaluation]:
        return list(self._cells.values())

    def offer(self, evaluation: Evaluation) -> bool:
        """Insert if the structure passes, is new and beats its cell's incumbent."""
        if evaluation.aesthetics is None or evaluation.fitness <= 0.0:
            return False
        key = evaluation.structure.canonical_key()
        if key in self._keys:
            return False
        cell = cell_of(evaluation)
        incumbent = self._cells.get(cell)
        if incumbent is not None and incumbent.fitness >= evaluation.fitness:
            return False
        if incumbent is not None:
            self._keys.discard(incumbent.structure.canonical_key())
        self._cells[cell] = evaluation
        self._keys.add(key)
        return True

    def sample(self, count: int, rng: np.random.Generator, *, augment: bool = True) -> list[Structure]:
        """Random elites, each under a random footprint symmetry when ``augment`` is set."""
        if not self._cells:
            raise ValueError("The archive is empty.")
        elites = self.elites
        picks = rng.integers(len(elites), size=count)
        return [
            elites[i].structure.transformed(int(rng.integers(8)) if augment else 0) for i in picks
        ]

    def coverage(self) -> float:
        return len(self._cells) / BINS**3

    def best_fitness(self) -> float:
        return max((e.fitness for e in self._cells.values()), default=0.0)


NEAR_DUPLICATE = 0.985
"""Coarse-shape cosine similarity at or above which two structures count as the same form."""


class ShapeIndex:
    """Remembers stored structures so near-duplicates are not stored again.

    Exact hashing misses forms that differ by a member or two; this compares
    coarse mass distribution under footprint symmetries.
    """

    def __init__(self, threshold: float = NEAR_DUPLICATE) -> None:
        self.threshold = threshold
        self._stored: list[Structure] = []

    def __len__(self) -> int:
        return len(self._stored)

    def is_novel(self, structure: Structure) -> bool:
        return all(shape_similarity(structure, other) < self.threshold for other in self._stored)

    def add(self, structure: Structure) -> bool:
        """Remember ``structure`` unless it duplicates one already remembered; returns whether it was added."""
        if not self.is_novel(structure):
            return False
        self._stored.append(structure)
        return True
