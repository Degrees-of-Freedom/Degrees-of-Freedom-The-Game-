"""Default member properties, used when a member carries none of its own.

The contract lets every member bring resolved properties (the game resolves
them from its cards). A member without them gets this standard steel section,
which is doubly symmetric (Iy == Iz) so its results do not depend on roll. The
numbers are representative of a 200 x 200 x 10 mm steel square hollow section;
they are a modelling default, not a design check.

Units: N, m.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MemberProperties:
    elastic_modulus: float = 210e9  # E, Pa
    shear_modulus: float = 81e9  # G, Pa
    area: float = 7.49e-3  # A, m^2
    inertia_y: float = 4.47e-5  # Iy, m^4
    inertia_z: float = 4.47e-5  # Iz, m^4
    torsion_constant: float = 7.03e-5  # J, m^4
    weight_per_length: float = 577.0  # N/m: 7850 kg/m^3 x A x 9.81 m/s^2

    @property
    def second_moment(self) -> float:
        """Kept for callers written when the section had one second moment."""
        return self.inertia_y


STEEL_MEMBER = MemberProperties()
