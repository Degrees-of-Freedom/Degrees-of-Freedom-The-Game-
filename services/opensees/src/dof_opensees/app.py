"""HTTP API for the OpenSees analysis engine.

Endpoints:

* ``GET /health`` - liveness and OpenSees version.
* ``GET /capabilities`` - what the solver models and its request limits.
* ``POST /analyze`` - body is a ``StructuralModel``; the response body is
  always an ``AnalysisResult`` from ``@dof/solver-contract``. Analysis
  outcomes (``success``, ``unstable``, ``unresolved``, and semantic
  ``unsupported`` or ``error``) return HTTP 200. A body that does not match
  the schema returns HTTP 422 with an ``error`` result, so clients can treat
  every response body the same way.

Configuration is by environment variable:

* ``DOF_OPENSEES_CORS_ORIGINS`` - comma-separated browser origins allowed to
  call the service. When unset, any port on localhost is allowed, because the
  Vite dev server picks another port when its usual one is taken.
* ``DOF_OPENSEES_MAX_NODES`` / ``DOF_OPENSEES_MAX_MEMBERS`` - request limits.
"""

from __future__ import annotations

import os

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__, engine
from .model import DEFAULT_PROPERTIES
from .schema import StructuralModel

#: Development default: a page served from this machine, on any port.
LOCAL_ORIGIN_PATTERN = r"http://(localhost|127\.0\.0\.1)(:\d+)?"

#: Connection patterns (UX UY UZ RX RY RZ in member local axes; L locked,
#: F free, E elastic) and how each is represented. Mirrors DESIGN.md,
#: "Connection capability".
CONNECTION_PATTERNS = [
    {"pattern": "LLLLLL", "members": "any", "representation": "Member end shares the node."},
    {"pattern": "LLLFFF", "members": "any", "representation": "Ball joint: translations tied exactly."},
    {"pattern": "LLLL[LF][LF]", "members": "any",
     "representation": "Hinge with torsion locked: beam end moment releases."},
    {"pattern": "LLL[EF][EF][EF], at least one E", "members": "any",
     "representation": "Translations tied exactly, rotational springs on member axes."},
    {"pattern": "[EF]x6, at least one E", "members": "any",
     "representation": "Springs on member axes only."},
    {"pattern": "FFFFFF", "members": "any", "representation": "Unattached: the end transfers nothing."},
    {"pattern": "any other", "members": "local axes parallel to global axes",
     "representation": "Exact constraints on global DOFs plus springs; exact for small joint rotations."},
]


def _limits() -> engine.Limits:
    defaults = engine.Limits()
    return engine.Limits(
        max_nodes=int(os.environ.get("DOF_OPENSEES_MAX_NODES", defaults.max_nodes)),
        max_members=int(os.environ.get("DOF_OPENSEES_MAX_MEMBERS", defaults.max_members)),
    )


def create_app() -> FastAPI:
    limits = _limits()
    origins = [
        origin.strip()
        for origin in os.environ.get("DOF_OPENSEES_CORS_ORIGINS", "").split(",")
        if origin.strip()
    ]

    app = FastAPI(title="Degrees of Freedom OpenSees service", version=__version__)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_origin_regex=None if origins else LOCAL_ORIGIN_PATTERN,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, error: RequestValidationError) -> JSONResponse:
        details = "; ".join(
            f"{'.'.join(str(part) for part in issue['loc'] if part != 'body') or 'body'}: {issue['msg']}"
            for issue in error.errors()[:5]
        )
        return JSONResponse(status_code=422, content={"status": "error", "message": f"Invalid model: {details}"})

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "service": __version__, "opensees": engine.opensees_version()}

    @app.get("/capabilities")
    def capabilities() -> dict:
        p = DEFAULT_PROPERTIES
        return {
            "id": "opensees",
            "name": "OpenSees static analysis",
            "solver": engine.solver_name(),
            "units": "SI",
            "fidelities": ["linear", "nonlinear"],
            "defaultFidelity": "nonlinear",
            "memberKinds": {
                "beam": "Elastic 3D beam-column (elasticBeamColumn); "
                f"{engine.NONLINEAR_SEGMENTS} elements per member under nonlinear fidelity.",
                "brace": "Axial element, tension and compression.",
                "cable": "Axial element, tension only at both fidelities.",
            },
            "connectionLaws": ["locked", "free", "elastic"],
            "connectionShorthands": ["fixed", "pinned", "free"],
            "connectionPatterns": CONNECTION_PATTERNS,
            "initialStrain": ["brace", "cable"],
            "loads": ["nodal-force", "nodal-moment", "self-weight"],
            "results": ["components", "displacements", "reactions", "memberForces", "stability"],
            "defaultMemberProperties": {
                "elasticModulus": p.elastic_modulus,
                "shearModulus": p.shear_modulus,
                "area": p.area,
                "inertiaY": p.inertia_y,
                "inertiaZ": p.inertia_z,
                "torsionConstant": p.torsion_constant,
                "weightPerLength": p.weight_per_length,
            },
            "limits": {
                "maxNodes": limits.max_nodes,
                "maxMembers": limits.max_members,
                "maxModes": limits.max_modes,
                "defaultTimeoutMs": limits.default_timeout_ms,
            },
        }

    # A plain ``def`` endpoint runs in FastAPI's thread pool, so a long solve
    # does not block the event loop; the engine serialises OpenSees access.
    @app.post("/analyze")
    def analyze(model: StructuralModel) -> dict:
        return engine.analyze(model, limits=limits)

    return app


app = create_app()
