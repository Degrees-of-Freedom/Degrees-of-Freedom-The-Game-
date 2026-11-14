"""Read the current tangent stiffness matrix out of the active OpenSees domain.

OpenSees does not expose its system matrix directly. The ``GimmeMCK``
integrator with coefficients (0, 0, 1) makes the left-hand side of a
transient step equal to the tangent stiffness K, and ``printA`` with the
``FullGeneral`` system returns it.

Verified behaviour (OpenSeesPy 3.8), which callers rely on:

* The matrix read back is the unfactored K, also when K is singular. OpenSees
  prints a solver warning to stderr in that case; it is harmless.
* The zero-length step does not change the state of the domain: nodal
  displacements and the load factor are untouched, so a static analysis can
  continue afterwards. The analysis objects are replaced, so the caller must
  set up its own analysis again before the next step.
* Equation numbers come from the ``Plain`` numberer and are only meaningful
  for this matrix. Read them with :func:`equation_numbers` straight after.
* OpenSees cannot be asked to analyse a system with zero free DOFs; it
  crashes the process. Callers must count free DOFs first.
"""

from __future__ import annotations

import numpy as np
import openseespy.opensees as ops


def extract_tangent() -> np.ndarray:
    """Return the free-DOF tangent stiffness of the domain at its current state."""
    ops.wipeAnalysis()
    ops.system("FullGeneral")
    ops.numberer("Plain")
    ops.constraints("Transformation")
    ops.algorithm("Linear")
    ops.integrator("GimmeMCK", 0.0, 0.0, 1.0)
    ops.analysis("Transient")
    ops.analyze(1, 0.0)
    size = ops.systemSize()
    return np.array(ops.printA("-ret"), dtype=float).reshape((size, size))


def equation_numbers(node_tag: int) -> list[int]:
    """Equation number of each DOF of a node, -1 where the DOF is not free.

    Only valid for nodes that are not the constrained side of an ``equalDOF``:
    OpenSees reports those in a different order.
    """
    return list(ops.nodeDOFs(node_tag))
