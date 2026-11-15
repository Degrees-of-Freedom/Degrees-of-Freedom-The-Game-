# Complete Grow Dusk Release — Codex Implementation Prompt

Complete this repository into the simple, polished, functional game specified by its knowledge base. Implement and verify the product—not just a plan, documentation, scaffolding, isolated demonstrations, or disconnected modules.

The owner has delegated routine product and implementation decisions to you. The first-release product decisions are already documented. Do not reopen those decisions or repeatedly request confirmation. Work autonomously, preserve existing useful functionality, and report completion honestly.

1. Establish the authoritative release target

Read AGENTS.md and docs/kb/README.md first.

Read every relevant criteria document and its appended section titled “Delegated first-release decisions — 2026-11-14.” Those appendices define the versioned grow-dusk-release-1 target and supersede earlier proposals on the same subjects. Any subsequent explicit owner decisions take precedence.

Include:
- Game completion and turn criteria.
- Card definitions, placement and joint freedoms.
- Scoring, failure and automatic repair.
- Solver and structural visualization criteria.
- Controls, multiplayer privacy and saved matches.
- Timburr/avatar and animation criteria.
- Release acceptance, code standards and the criteria ledger.

Distinguish requirements from historical implementation claims. Verify the current code yourself; neither old documentation nor previous screenshots establish current compliance.

The selected release includes:
- Grow Dusk as the normal Play experience.
- Two local players and eight complete rounds: 16 turns.
- The frozen deck, hand, placement, scoring and repair policies.
- End-turn authoritative assessment.
- Compact Timburr feedback, qualified Conkeldurr reactions and restrained animations.
- Complete saving, recovery, privacy handoff and final results.
- Browser operation without accounts or a manually started solver service for ordinary play.

Use the exact definitions in the appended criteria rather than recreating these rules from this summary. A curated default deck does not waive other mandatory catalogue or numerical requirements. Preserve existing working modes behind the documented secondary navigation.

Create or update a single traceability checklist in the knowledge base. For each requirement record its source, implementation location, gap, owner and acceptance evidence. Distinguish mandatory requirements from explicitly deferred work; do not label a difficult requirement optional yourself.

2. Audit briefly, then implement

Inspect the current architecture, runtime paths, shared contracts, dependencies, persistence, deployment configuration and tests. Run baseline checks and use the application.

Identify:
- Required behavior that is missing, incorrect or unwired.
- Competing old and new implementations.
- Numerical limitations and unsupported states.
- Redundant UI, repeated information and unnecessary interactions.
- Save, privacy, accessibility and release risks.

Do not spend the task producing an exhaustive analysis before making progress. Begin concrete implementation after the initial baseline review and maintain the checklist as you work.

Do not rebuild working systems unnecessarily. Reuse and integrate completed domain, solver, scene and presentation modules where appropriate. Resolve competing runtime paths so the real product has one clear authority for rules, state and analysis.

3. Coordinate agents without conflicts

Use one integration owner, up to four implementation agents and a separate final verification agent.

Delegate independent responsibilities with:
- Exclusive file/module ownership.
- Explicit shared interfaces.
- Deliverables and acceptance criteria.
- Known dependencies and integration order.

Agree shared contracts before parallel implementation. The integration owner controls shared contracts, manifests, global integration and the criteria ledger. Agents must coordinate changes to those files rather than editing them simultaneously.

Use isolated branches/worktrees where appropriate. Integrate small coherent changes frequently. Do not allow multiple agents to build competing versions of the same subsystem.

Have the independent verification agent assess the integrated product against the original criteria, rather than merely reviewing each agent’s summary.

4. Deliver integrated milestones

Organize the work into milestones that leave the actual product runnable:

A. Authoritative rules, card catalogue, setup, draw/hand lifecycle and placement.
B. Required browser physics, connection laws, validity and component isolation.
C. Issue comparison, historical penalties, physical repair and final scoring.
D. Complete persistence, recovery, private handoff and conflict handling.
E. Minimal UI, contextual inspection, avatar feedback and animations.
F. Full-game acceptance, numerical verification, performance and cleanup.

Adjust the dependency order where the code requires it, but preserve complete requirement coverage.

A feature is not complete until reachable through the normal application, connected to authoritative state, persisted where required, and tested through its real user flow.

Standalone fixtures and agent-specific preview pages may support development. They cannot substitute for production integration.

5. Preserve physical and gameplay correctness

Meet the solver criteria using analytical and independently trusted references.

Implement required frame, cable, spring, assembly, connection and quarter-port behavior under the documented scope. Do not silently represent unsupported elements as ordinary beams.

Preserve:
- Intentional connectivity and genuine mechanisms.
- Exact constraints and relevant DOF handling.
- Required nonlinear behavior and buckling validation.
- Signed reactions, including uplift.
- Component-scoped validity.
- Explicit unavailable and unresolved results.
- Separate strength, deformation and instability classifications.

Authoritative ordinary play must use the required in-browser numerical path. Close missing numerical coverage rather than hiding it behind a service startup requirement or heuristic fallback.

Never fabricate equilibrium, declare an unloaded mechanism stable because its residual is zero, or treat solver failure as physical collapse. A surrogate or illustrative load-path graph cannot replace authoritative physics.

Implement the documented issue history, one-point penalty policy and bounded physical correction. Preserve player objects and loads. Record neutral repairs and their actual reactions separately; never introduce hidden artificial supports or credit neutral support to a player.

Keep game legality, responsibility, scoring and penalties outside the physics kernel.

Keep turns atomic and retries idempotent. One accepted turn must never produce duplicate draws, card consumption, repairs, penalties or finalization.

6. Make the product simple and delightful

Follow the appended controls/layout decisions:
- One board.
- One active-hand tray.
- One compact turn header.
- One primary End turn/Pass action.
- One contextual inspection drawer.
- One menu for settings, secondary modes and restart.

Remove redundant panels, duplicated statistics, repeated instructions and permanently exposed implementation details. Keep secondary engineering information available through inspection.

Make the current state, next legal action, analysis wait and turn outcome immediately understandable. Prefer contextual targets, ghosts and short feedback over explanatory walls of text.

Simplification must preserve required functionality, truthful validity, accessible controls and recovery.

Implement the documented Timburr and Conkeldurr behavior with the preserved attributed assets and correct fallbacks. Reactions must follow real scoped public events and never expose private cards, predict safety or change game state.

Implement the specified motion/audio timings, priorities, cooldowns, skip behavior, mute, reduced motion and resource cleanup. Do not claim expressive animation merely because a static model loads.

Keep routine feedback subtle. Reserve spectacle for qualified events and actual final outcomes. Decorative effects must never block input, delay analysis or obscure targets.

7. Complete persistence and operational behavior

Implement the selected save storage, versioning, recovery revision, import/export and size policies.

Persist the whole authoritative match, including draws, draft state, committed topology, event history, penalties, repairs, rules/catalogue versions and final receipts.

Handle:
- Reload and interrupted operations.
- Failed writes and quota exhaustion.
- Corrupted, legacy and future-version saves.
- Stale tabs and conflicting writers.
- Restart cancellation and failed replacement saves.
- GPU, model, decoder and audio failures.

Preserve source bytes and recovery options. Do not silently reset a damaged save or claim a write succeeded before acknowledgement.

Keep privacy covers effective through reload, backgrounding, handoff and recovery. Public views and exports must not contain hidden hands, deck order or private draft data.

8. Verify the actual finished game

Run the current repository’s relevant commands, including:
- npm run typecheck
- npm test
- npm run test:solver
- npm run test:opensees
- npm run build:solver
- npm run build
- Relevant benchmark and browser acceptance runners

Inspect the scripts first and add missing reproducible checks where necessary. Ensure the production build actually uses the newly built solver artifact rather than stale generated output.

Add meaningful tests for new behavior and regressions. Do not weaken tests, numerical tolerances or acceptance thresholds to obtain a pass.

Numerical acceptance is separate from ordinary unit tests:
- Analytical/reference accuracy.
- Nonlinear and buckling fixtures.
- Connection and quarter-port laws.
- Force/moment balance and classification.
- The required 10,000-state suite.
- Representative and 500-member stress/performance workloads.

Run complete 16-turn matches for seeds 0–19 through the real production UI with the real solver.

These must include purposeful element, connection and load plays. Twenty all-pass matches or state injection does not establish gameplay acceptance. Test all-pass/zero-gravity separately.

Visually inspect at least three complete games:
- Ordinary play through final scoring.
- Adverse moves, penalties and physical neutral repair.
- Interrupted play, save/reload and recovery.

Also verify:
- Signed uplift, partial evidence, ties and final-round passes.
- Quarter targets, clashes and incompatible connectors.
- Shared access and immutable placed connections.
- Stale results, rapid repeated input and two-tab conflicts.
- Storage corruption/quota failures.
- Avatar event correctness and asset/audio/GPU fallbacks.
- Keyboard-only play, reduced motion, mute and 200% zoom.
- Supported layouts, browser/device and assistive-technology requirements.
- Bounded memory, effects, audio, workers and listeners.

Record build, seed, rules/solver versions, expected versus actual results and evidence artifacts. Test the final integrated build after fixes.

If a required platform or physical device is unavailable, mark that gate “not run”; emulation is not proof of real-device acceptance. Complete all independent work and prepare reproducible instructions for the missing check. Never convert missing evidence into a pass.

9. Housekeeping and documentation

Remove genuinely unused code, dependencies, assets and obsolete duplicate paths after checking references and replacement coverage. Preserve working modes, valid saves, attribution and other contributors’ work.

Prefer cohesive modules, explicit interfaces, clear naming and straightforward logic. Avoid speculative frameworks, unnecessary services and abstraction for its own sake.

Update affected knowledge-base pages in the same changes as implementation. Preserve requirement history while making current behavior and superseding decisions clear.

Maintain the traceability checklist and criteria ledger with current evidence. Document the final architecture, solver assumptions, UI behavior, avatar events, animations, save/recovery process, build/deployment instructions and remaining limitations.

10. Integrate, review and finish

Work on a reviewable integration branch. Commit coherent changes, push the branch and create a PR. Have the verification agent review the final integrated diff and acceptance evidence.

When required checks pass, merge to main through the permitted repository workflow. Respect protections; never force-push or overwrite unrelated changes. Verify main contains the intended result.

Verify a deployable production artifact and document its hosting requirements. Do not confuse a successful build with deployment or release acceptance. Public deployment requires existing authorization and available configuration.

Do not stop after an assessment, the first successful milestone or a partial implementation. Keep working through the remaining authorized requirements.

Resolve residual routine choices yourself and document them. Ask only for genuine consequential ambiguity or external access that cannot be resolved from the criteria and delegated authority. Explain the precise blocker, and continue unaffected work.

Finish with:
- What changed for players.
- Requirement coverage and remaining gaps.
- Automated, numerical and complete-game results.
- Performance and platform evidence.
- Documentation, PR and commit links.
- Release status: complete and verified, or explicitly incomplete with exact blockers.

Do not call the product complete or production-ready while mandatory functionality, integration, numerical validation or release evidence is missing.
