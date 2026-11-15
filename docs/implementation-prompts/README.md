# Four concurrent Codex/Claude implementation sessions

Start all four from the **same baseline containing criteria commit `17415db`**, each in its own worktree and feature branch. Read the [parallel ownership/port contract](parallel-contract.md). The prompts authorize implementation when pasted into separate sessions; creating these documents does not execute them.

1. [Rules and domain](01-multiplayer-rules-and-model.md).
2. [Physics checkpoints and minimum correction](02-checkpoints-and-minimal-correction.md).
3. [Scene, inspector, snapping and axial vectors](03-workspace-inspector-and-load-vectors.md).
4. [Active avatar, application shell and final integration](04-active-avatar-and-event-polish.md).

All four implement their owned scope concurrently against fixtures/injected adapters. Session 4 integrates the **finished** outputs last and runs end-to-end acceptance; that final join necessarily depends on the other three results. No session edits another’s working tree, imports an unmerged peer dependency or pushes main without separate authorization. The latest [multiplayer criteria](../kb/multiplayer-refresh-criteria.md) remain authoritative. Handoff files are future outputs, not existing evidence.
