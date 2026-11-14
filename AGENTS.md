# Project guidance

Start with [docs/kb/README.md](docs/kb/README.md), the canonical entry point for project knowledge. The game is at the concept stage, with three intended areas: the structural solver, game architecture and turn dynamics, and 3D viewer. Do not present proposed designs as implemented behavior.

## Git workflow

- Work on a feature branch by default, unless the user directs otherwise. Create one before making changes when starting from `main`.
- Commit frequently in small, coherent increments with descriptive messages. Keep unrelated changes separate and preserve other contributors' work.

## Documentation

Keep the implementation well documented inline and in the knowledge base. Add and maintain clear comments and API documentation where they explain behavior, decisions, assumptions, or non-obvious logic; keep them accurate as code changes. Prefer clear code to comments that merely repeat it.

Update the relevant knowledge-base pages in the same change when durable facts or decisions change. Ground claims in code, tests, configuration, or explicitly identified decisions; record uncertainty rather than inventing details. Treat other documentation as context unless the knowledge base cites and validates it.
