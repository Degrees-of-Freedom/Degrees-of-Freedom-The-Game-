---
title: "Development and Testing"
last_validated: 2026-11-14
validated_against:
  - README.md
  - .gitignore
  - environment.yml
  - prototypes/voxel-struct/README.md
owner: unknown
status: partial
---

# Development and Testing

## Purpose

Provide verified development and testing guidance as implementation begins.

## Current state

The standalone Voxel Struct prototype can be served from the repository root with `python -m http.server 8765 --directory prototypes/voxel-struct`; it loads Three.js from a CDN. See its README for scope and manual checks.

The root `environment.yml` specifies a Conda environment named `degrees-of-freedom` with Python 3.11 and pip. Create it using `conda env create -f environment.yml` and activate it with `conda activate degrees-of-freedom`. The prototype server uses the Python standard library and does not require third-party Python packages. Environment creation has not been verified here.

## Open questions

- What toolchain and commands will contributors use to build, run, and test the project?
- What reference problems will verify solver results, and how will turn rules and viewer interactions be tested?
