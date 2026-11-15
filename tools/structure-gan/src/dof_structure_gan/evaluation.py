"""Fitness: the physics gate combined with the aesthetic components."""

from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass

from .lattice import Structure
from .metrics import Aesthetics, score
from .physics import LoadCase, PhysicsResult, analyse


@dataclass(frozen=True)
class Criteria:
    """What counts as an *excellent* structure worth keeping in the database."""

    min_fitness: float = 0.62
    min_component: float = 0.3
    min_members: int = 20
    structural_weight: float = 0.3


@dataclass(frozen=True)
class Evaluation:
    structure: Structure
    physics: PhysicsResult
    aesthetics: Aesthetics | None
    structural: float
    fitness: float
    excellent: bool


def evaluate(structure: Structure, case: LoadCase = LoadCase(), criteria: Criteria = Criteria()) -> Evaluation:
    """Zero fitness unless the oracle says the structure is stable *and* within limits.

    The structural term rewards margin below the strength and stiffness limits
    but only 30% of the total, so the optimiser cannot buy score by over-building.
    """
    physics = analyse(structure, case)
    if not physics.passes or physics.utilization is None or physics.displacement_ratio is None:
        return Evaluation(structure, physics, None, 0.0, 0.0, False)
    structural = 0.5 * max(0.0, 1 - physics.utilization / case.max_utilization) + 0.5 * max(
        0.0, 1 - physics.displacement_ratio / case.max_displacement_ratio
    )
    aesthetics = score(structure)
    fitness = criteria.structural_weight * structural + (1 - criteria.structural_weight) * aesthetics.total
    excellent = (
        fitness >= criteria.min_fitness
        and aesthetics.weakest >= criteria.min_component
        and len(structure.edges) >= criteria.min_members
    )
    return Evaluation(structure, physics, aesthetics, structural, fitness, excellent)


def _evaluate_args(args: tuple[Structure, LoadCase, Criteria]) -> Evaluation:
    return evaluate(*args)


class Evaluator:
    """Evaluate batches, optionally across processes (OpenSees keeps global state per process)."""

    def __init__(self, case: LoadCase = LoadCase(), criteria: Criteria = Criteria(), workers: int = 1) -> None:
        self.case, self.criteria, self.workers = case, criteria, workers
        self._pool: ProcessPoolExecutor | None = None
        if workers > 1:
            import multiprocessing

            self._pool = ProcessPoolExecutor(workers, mp_context=multiprocessing.get_context("spawn"))

    def __call__(self, structures: list[Structure]) -> list[Evaluation]:
        jobs = [(s, self.case, self.criteria) for s in structures]
        if self._pool is None:
            return [_evaluate_args(job) for job in jobs]
        return list(self._pool.map(_evaluate_args, jobs, chunksize=max(1, len(jobs) // (4 * self.workers))))

    def close(self) -> None:
        if self._pool is not None:
            self._pool.shutdown()

    def __enter__(self) -> Evaluator:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
