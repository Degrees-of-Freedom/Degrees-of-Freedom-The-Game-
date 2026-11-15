"""HTTP API for the OpenSees analysis engine.

Endpoints:

* ``GET /health`` - liveness and OpenSees version.
* ``GET /capabilities`` - what the solver models and its request limits.
* ``POST /analyze`` - body is a ``StructuralModel``; the response body is
  always an ``AnalysisResult`` from ``@dof/solver-contract``. Analysis
  outcomes (``success``, ``unstable``, semantic ``error``) return HTTP 200. A
  body that does not match the schema returns HTTP 422 with an ``error``
  result, so clients can treat every response body the same way.

Configuration is by environment variable:

* ``DOF_OPENSEES_CORS_ORIGINS`` - comma-separated browser origins allowed to
  call the service. When unset, any port on localhost is allowed, because the
  Vite dev server picks another port when its usual one is taken.
* ``DOF_OPENSEES_MAX_NODES`` / ``DOF_OPENSEES_MAX_MEMBERS`` - request limits.
"""

from __future__ import annotations

import os
from dataclasses import asdict

import openseespy.opensees as ops
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__, engine
from .properties import STEEL_MEMBER
from .schema import StructuralModel

#: Development default: a page served from this machine, on any port.
LOCAL_ORIGIN_PATTERN = r"http://(localhost|127\.0\.0\.1)(:\d+)?"


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
        return {"status": "ok", "service": __version__, "opensees": ops.version()}

    @app.get("/capabilities")
    def capabilities() -> dict:
        return {
            "id": "opensees",
            "name": "OpenSees linear static",
            "analysis": "linear-elastic-static",
            "optionalAnalysis": ["corotational"],
            "units": "SI",
            "memberEndFixities": ["fixed", "pinned"],
            "loads": ["nodal-force", "nodal-moment"],
            "results": ["displacements", "reactions", "memberForces", "stability", "components"],
            "memberProperties": asdict(STEEL_MEMBER),
            "limits": {"maxNodes": limits.max_nodes, "maxMembers": limits.max_members, "maxModes": limits.max_modes,
                       "maxLinearEquations": limits.max_linear_equations, "maxNonlinearEquations": 1200,
                       "maxNonlinearAttempts": limits.max_nonlinear_attempts},
        }

    # A plain ``def`` endpoint runs in FastAPI's thread pool, so a long solve
    # does not block the event loop; the engine serialises OpenSees access.
    @app.post("/analyze")
    def analyze(model: StructuralModel) -> dict:
        return engine.analyze(model, limits=limits)

    return app


app = create_app()
