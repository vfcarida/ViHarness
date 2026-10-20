# ADR 014: Immutable Harness Constitution and Capability Classes

- **Status:** Accepted
- **Date:** 2026-10-20
- **Context:** Self-evolving agent harnesses face a fundamental security hazard: an unconstrained optimizer may weaken policy enforcement, disable sandboxing, open unrestricted network egress (a documented operational risk in reference substrates such as Harness²), forge audit signatures, or lower its own admission criteria to maximize task pass rates.
- **Decision:** Introduce an explicit, cryptographically hashed `HarnessConstitution` (`src/core/evolution/constitution.ts`) that partitions all harness components into four capability classes:
  1. `GUIDANCE` (`systemPrompt`, `toolGuidance`) — evolvable in sandbox (`E1_SINGLE_CONTRAST` for task, `E4_GENERALIZATION` for global promotion).
  2. `DECLARATIVE` (`guardrails`, `memoryPolicy`, `subagents`, `skills`, `contextPolicy`, `routingPolicy`, `verificationPolicy`, `toolSchedulingPolicy`) — evolvable with Zod schema validation (`E2_REPLICATED_CONTRAST` for task, `E4_GENERALIZATION` for global promotion).
  3. `EXECUTABLE` (`scripts`, `plugins`) — evolvable only under `PreWriteSyntaxGate` static AST validation, sandbox confinement, and `E3_VERIFIED` task / `E4_GENERALIZATION` promotion gates.
  4. `CONSTITUTIONAL` (`policy_engine`, `privilege_boundary`, `filesystem_confinement`, `secret_scrubber`, `audit_integrity_signer`, `admission_gate`, `rollback_manager`, `trusted_verification_boundary`) — **immutable** by any self-evolution proposer, composer, or auto-tuner.
- **Consequences:**
  - The optimizer is never `root` over the process that evaluates and admits it.
  - Newly proposed scripts or plugins cannot grant themselves additional filesystem, network, or process privileges.
  - Any candidate attempting to mutate a constitutional surface or inject a bypass directive is immediately rejected and quarantined.
