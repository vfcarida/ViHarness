# ADR 015: Canonical HarnessManifest and Evolvable Surface Registry

- **Status:** Accepted
- **Date:** 2026-10-20
- **Context:** Previously, "the harness" was implicit state scattered across constructor options, environment flags, memory records, and plugin registrations. Contrastive probing, structural diffing, lineage tracking, and instant rollback require a first-class, canonical artifact.
- **Decision:**
  1. Define `HarnessManifest` (`src/core/evolution/harness-manifest.ts`) and `HarnessManifestToolkit` (`src/infra/evolution/manifest-toolkit.ts`) with deterministic key-sorted JSON serialization, SHA-256 content addressing, parent lineage (`parentId`, `ancestryIds`), structural and component-level `diff()`, `validate()`, `materialize()`, `cloneWithOverrides()`, `createReplayPlan()`, `rollback()`, and HMAC-SHA256 provenance signing.
  2. Expose 8 Harness²-compatible components (`systemPrompt`, `guardrails`, `memoryPolicy`, `toolGuidance`, `subagents`, `skills`, `scripts`, `plugins`) plus 4 Vi-Harness native policy extensions (`contextPolicy`, `routingPolicy`, `verificationPolicy`, `toolSchedulingPolicy`), alongside `EightComponentAdapter` for clean-room external interoperability.
  3. Enforce `DefaultHarnessSurfaceRegistry` (`src/infra/evolution/default-surface-registry.ts`) so only explicitly registered surfaces can be targeted by the optimizer, preventing arbitrary source-file mutation.
- **Consequences:**
  - Every candidate manifest is deeply frozen (`Object.freeze`) before probing begins.
  - Any harness configuration can be deterministically inspected, diffed, replayed, exported, or rolled back via CLI (`vi-harness harness inspect|diff|validate|replay`).
