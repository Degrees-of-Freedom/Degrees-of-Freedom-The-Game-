"""The single steel member used for every element.

The game does not size members, so every member shares one material and one
doubly symmetric section. Symmetry (Iy == Iz) means results do not depend on
how a member is rolled about its own axis, so the contract needs no local
axis convention. The numbers are representative of a 200 x 200 x 10 mm steel
square hollow section; they are a modelling choice, not a design check.

Units: N, m.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MemberProperties:
    elastic_modulus: float = 210e9  # E, Pa
    shear_modulus: float = 81e9  # G, Pa
    area: float = 7.49e-3  # A, m^2
    second_moment: float = 4.47e-5  # Iy = Iz, m^4
    torsion_constant: float = 7.03e-5  # J, m^4


STEEL_MEMBER = MemberProperties()
