# OpenSees analysis service. Build from this directory:
#   docker build -t dof-opensees services/opensees
#   docker run --rm -p 8000:8000 dof-opensees
FROM python:3.12-slim

# uv installs the locked dependency set, including the OpenSeesPy Linux wheel.
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv

# The OpenSeesPy Linux binary links against these system libraries.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libgfortran5 libblas3 liblapack3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1

COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev

# OpenSees holds one global model per process, so scale with processes.
ENV DOF_OPENSEES_WORKERS=2
EXPOSE 8000
CMD ["sh", "-c", "exec uv run --no-sync uvicorn dof_opensees.app:app --host 0.0.0.0 --port 8000 --workers ${DOF_OPENSEES_WORKERS}"]
