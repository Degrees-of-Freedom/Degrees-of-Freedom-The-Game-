"""Physics oracle: the repository's OpenSees engine on a fixed, factored load case.

The engine is the same ``dof_opensees.engine.analyze`` that backs the game's
OpenSees check, so a structure judged stable here is judged by the project's
own reference solver rather than a re-implementation. To keep that verdict
meaningful for the game, the section is the game's own ``shs`` card
(SHS 100x6, S355: ``apps/web/src/evaluator/sections.ts``), members have rigid
ends and every supported node is a fully fixed foundation, which matches the
game's ``joint`` voxel semantics. Self-weight is added as nodal loads. Loads
carry the game's ULS partial factors (1.35 dead, 1.5 applied). Utilisation is
an elastic screening check, not a design-code check; see
``docs/kb/structure-gan.md`` for its limits.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from dof_opensees.engine import analyze
from dof_opensees.schema import StructuralModel

from .lattice import CELL_METRES, Structure

# Game card ``shs`` (kN/m units converted to SI): see evaluator/sections.ts. The engine takes
# per-member properties in the contract; self-weight is added here as factored nodal loads, so the
# engine's own ``selfWeight`` option stays off.
ELASTIC_MODULUS_PA = 210e9
SHEAR_MODULUS_PA = 81e9
AREA_M2 = 2.24e-3
SECOND_MOMENT_M4 = 3.2e-6
TORSION_CONSTANT_M4 = 5.13e-6
SHS_PROPERTIES = {
    "elasticModulus": ELASTIC_MODULUS_PA, "shearModulus": SHEAR_MODULUS_PA, "area": AREA_M2,
    "inertiaY": SECOND_MOMENT_M4, "inertiaZ": SECOND_MOMENT_M4, "torsionConstant": TORSION_CONSTANT_M4,
}
YIELD_STRESS_PA = 355e6
SECTION_MODULUS_M3 = 6.4e-5
SELF_WEIGHT_N_PER_M = 176.0
AXIAL_CAPACITY_N = YIELD_STRESS_PA * AREA_M2
MOMENT_CAPACITY_NM = YIELD_STRESS_PA * SECTION_MODULUS_M3
EULER_COEFFICIENT = math.pi**2 * ELASTIC_MODULUS_PA * SECOND_MOMENT_M4
"""pi^2 E I: divide by the member length squared for the pinned-pinned Euler load."""
DEAD_FACTOR = 1.35
LIVE_FACTOR = 1.5


@dataclass(frozen=True)
class LoadCase:
    """Characteristic point load per loaded node, with self-weight and a notional lateral push.

    ``vertical_n`` is the *unfactored* applied load; the partial factors are
    applied inside :func:`build_model`.

    ``max_utilization`` is deliberately well below 1. The game's own design
    check (``apps/web/src/evaluator/designChecks.ts``) is stricter than this
    module's elastic screen. On 114 oracle-passing seeds the two utilisations
    correlated at 0.84; with a limit of 0.5, 41 of 42 passing structures stayed
    at or below 1 in the game, and 0.45 is used for margin. The Node test
    ``evolvedStructures.test.ts`` re-checks every stored structure in the game.
    """

    vertical_n: float = 2_000.0
    lateral_fraction: float = 0.03
    max_utilization: float = 0.45
    max_displacement_ratio: float = 1 / 60
    both_wind_directions: bool = False
    """Also analyse the reversed notional push and keep the worse of the two."""

    def __post_init__(self) -> None:
        if self.vertical_n <= 0 or not 0 <= self.lateral_fraction < 1:
            raise ValueError("Load case needs a positive vertical load and a lateral fraction in [0, 1).")


@dataclass(frozen=True)
class PhysicsResult:
    """Oracle verdict. ``None`` metrics mean the solver produced no verified response."""

    stable: bool
    status: str
    message: str | None = None
    utilization: float | None = None
    max_displacement_m: float | None = None
    displacement_ratio: float | None = None
    residual: float | None = None
    within_limits: bool = False
    """Utilisation and displacement both inside the load case's limits."""

    @property
    def passes(self) -> bool:
        return self.stable and self.within_limits


def _applied_forces(structure: Structure, case: LoadCase, wind: float = 1.0) -> tuple[dict, float]:
    """Factored nodal forces (N) by lattice node, and their total vertical magnitude."""
    forces: dict = {n: [0.0, 0.0, 0.0] for n in structure.nodes}
    for a, b in structure.edges:
        length = CELL_METRES * math.dist(a, b)
        for end in (a, b):
            forces[end][2] -= DEAD_FACTOR * SELF_WEIGHT_N_PER_M * length / 2
    lateral = wind * LIVE_FACTOR * case.vertical_n * case.lateral_fraction / math.sqrt(2)
    for node in structure.loads:
        forces[node][0] += lateral
        forces[node][1] += lateral
        forces[node][2] -= LIVE_FACTOR * case.vertical_n
    return forces, -sum(f[2] for f in forces.values())


def build_model(structure: Structure, case: LoadCase, wind: float = 1.0) -> dict:
    """Translate a structure to the OpenSees service contract (metres, newtons)."""
    positions = structure.positions_metres()
    ids = {node: f"n{index}" for index, node in enumerate(sorted(positions))}
    forces, _ = _applied_forces(structure, case, wind)
    return {
        "units": "SI",
        "nodes": [{"id": ids[n], "position": list(p)} for n, p in sorted(positions.items())],
        "members": [
            {"id": f"m{i}", "startNodeId": ids[a], "endNodeId": ids[b], "properties": SHS_PROPERTIES}
            for i, (a, b) in enumerate(sorted(structure.edges))
        ],
        "supports": [{"nodeId": ids[n], "restrained": [True] * 6} for n in sorted(structure.supports)],
        "loads": [
            {"nodeId": ids[n], "force": forces[n], "moment": [0.0, 0.0, 0.0]}
            for n in sorted(structure.nodes)
        ],
    }


def analyse(structure: Structure, case: LoadCase = LoadCase()) -> PhysicsResult:
    """Solve the structure and screen strength and stiffness (worst of the wind directions)."""
    results = [_analyse_once(structure, case, 1.0)]
    if case.both_wind_directions and results[0].stable:
        results.append(_analyse_once(structure, case, -1.0))
    failed = next((r for r in results if not r.stable or r.utilization is None), None)
    if failed is not None:
        return failed
    worst_u = max(r.utilization for r in results if r.utilization is not None)
    worst_ratio = max(r.displacement_ratio for r in results if r.displacement_ratio is not None)
    worst_d = max(r.max_displacement_m for r in results if r.max_displacement_m is not None)
    return PhysicsResult(
        True, results[0].status, None, worst_u, worst_d, worst_ratio, max(r.residual or 0.0 for r in results),
        within_limits=worst_u <= case.max_utilization and worst_ratio <= case.max_displacement_ratio,
    )


def _analyse_once(structure: Structure, case: LoadCase, wind: float) -> PhysicsResult:
    result = analyze(StructuralModel.model_validate(build_model(structure, case, wind)))
    status = str(result.get("status"))
    stability = result.get("stability", {})
    if status != "success" or not stability.get("stable", False):
        return PhysicsResult(False, status, result.get("message"))

    positions = structure.positions_metres()
    ordered = sorted(positions)
    extent = max(max(c) - min(c) for c in zip(*positions.values())) or 1.0
    displacement = max(
        math.sqrt(sum(v * v for v in result["displacements"][f"n{i}"][:3])) for i in range(len(ordered))
    )
    lengths = [CELL_METRES * math.dist(a, b) for a, b in sorted(structure.edges)]

    def member_utilization(index: int, forces: dict) -> float:
        axial = forces["axial"]
        # Compression is limited by pinned-pinned Euler buckling when that is lower than yield.
        capacity = min(AXIAL_CAPACITY_N, EULER_COEFFICIENT / lengths[index] ** 2) if axial < 0 else AXIAL_CAPACITY_N
        return abs(axial) / capacity + max(abs(forces["momentStart"]), abs(forces["momentEnd"])) / MOMENT_CAPACITY_NM

    utilization = max(member_utilization(i, result["memberForces"][f"m{i}"]) for i in range(len(lengths)))
    applied = _applied_forces(structure, case, wind)[1]
    reacted = sum(r[2] for r in result["reactions"].values())
    residual = abs(reacted - applied) / applied
    if residual > 1e-6 or not all(math.isfinite(v) for v in (utilization, displacement)):
        return PhysicsResult(False, "unverified", f"Vertical equilibrium residual {residual:.2e}.")
    ratio = displacement / extent
    return PhysicsResult(
        True, status, None, utilization, displacement, ratio, residual,
        within_limits=utilization <= case.max_utilization and ratio <= case.max_displacement_ratio,
    )
