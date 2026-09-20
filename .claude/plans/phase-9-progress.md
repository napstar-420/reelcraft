# Phase 9 — Editor & Templates: implementation progress

Plan: `docs/plans/phase-9-editor-templates.md`
Branch: `codex/phase9-editor-templates`

## Chunks

- [x] Chunk 1 — Capability resolve + check-types plumbing
- [ ] Chunk 2 — `POST /checks/test`
- [ ] Chunk 3 — `POST /blueprints/:id/validate`
- [ ] Chunk 4 — Template library completion
- [ ] Chunk 5 — Dry-run execution
- [ ] Chunk 6 — Frontend: capability config form + schema editor panel
- [ ] Chunk 7 — Frontend: check tester, template library, dry-run trigger

## Notes / deviations from plan

### Chunk 1

- The plan doc's claim that `MediaAnalyzeCapability` (or any capability)
  branches `slots()`/`allowedOutputs()` on config turned out to be false —
  every capability in the codebase ignores its config parameter for both
  methods today (confirmed by reading all impls under
  `apps/api/src/capability/impls/`). The unit test still verifies `resolve()`
  correctly delegates to `impl.slots(config)`/`impl.allowedOutputs(config)`
  across different configs; it just doesn't assert config-conditional output,
  since no capability currently produces one. `BuiltinCheck` did not
  previously have a `description` field — added one as part of this chunk
  since `GET /check-types` needs it.
- The first attempt at this chunk (a subagent) was killed mid-run by a
  transient network error right after finishing all the code changes and
  starting `pnpm --filter @reefcraft/api typecheck`. Its uncommitted changes
  were verified and one bug was fixed directly: the new
  `capability.controller.test.ts` called `image.slots(config)` /
  `audio.allowedOutputs(config)` on concrete `ImageGenerateCapability`/
  `AudioSpeechCapability` instances whose own method overrides declare zero
  parameters, which doesn't type-check when called with an argument even
  though JS would accept it at runtime. Fixed by casting each instance to
  `CapabilityImpl` first (`new ImageGenerateCapability(...) as unknown as
CapabilityImpl`), mirroring the exact cast `capability.registry.ts` already
  uses for the same underlying variance reason.
