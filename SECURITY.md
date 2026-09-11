# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x (main) | ✅ Active |

Only the latest commit on `main` receives security fixes. We do not backport to older versions until the project reaches 1.0.

---

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

To report a security issue, use one of the following methods:

1. **GitHub Private Security Advisory** (preferred):
   Go to the repository's **Security → Advisories → Report a Vulnerability** page and open a private advisory. GitHub will notify the maintainers privately.

2. **Email** (fallback):
   Send a report to the address in the repository's `package.json` `"author"` field if present, or contact the CODEOWNERS directly through GitHub's private messaging.

Include as much of the following as possible:

- Type of vulnerability (e.g., path traversal, prompt injection, RCE)
- The affected component (`src/infra/security/`, a specific tool, etc.)
- Steps to reproduce or a proof-of-concept
- Potential impact assessment
- Any suggested mitigations

---

## Response Timeline

| Milestone | Target |
|---|---|
| Acknowledgement | Within 3 business days |
| Initial assessment | Within 7 business days |
| Fix or mitigation | Depends on severity — see below |
| Public disclosure | Coordinated with reporter |

### Severity-based fix targets

| CVSS severity | Target fix timeline |
|---|---|
| Critical (9.0–10.0) | ≤ 7 days |
| High (7.0–8.9) | ≤ 14 days |
| Medium (4.0–6.9) | ≤ 30 days |
| Low (0.1–3.9) | Next scheduled release |

---

## Scope

### In scope

- All code under `src/`
- All GitHub Actions workflows under `.github/workflows/`
- Dependency vulnerabilities in `package.json` with CVSS ≥ 7.0

### Out of scope

- Vulnerabilities in the **target repository** that Vi-Harness operates on (Vi-Harness is the *agent*, not the *codebase being modified*)
- Issues that only manifest when the caller deliberately misconfigures `PermissionContext` to grant unrestricted access
- Denial of service through deliberately malformed goal specifications (no credentials or privileged access gained)

---

## Security Architecture Notes

Vi-Harness applies defence-in-depth across four layers. Reviewers and researchers should be aware:

1. **Application-Level Validation**: Path canonicalisation, null-byte rejection, prototype pollution defence, approval-key stripping.
2. **Policy Engine (Deny-First)**: Declarative, deterministic permission evaluation. All rule evaluations are audited.
3. **Execution Sandbox**: Process timeout bounds, git hook isolation (`-c core.hooksPath=/dev/null`), subagent permission containment and nesting limits.
4. **Output Sanitisation**: `SecretScrubber` automatically redacts credentials from all tool outputs and compiled context.

## Dependency Audit Policy

Vi-Harness enforces automated dependency auditing on every push and pull request:

- **CI build gate** (`ci.yml`): `npm audit --audit-level=high` — blocks the build if any dependency has a High or Critical severity CVE.
- **Weekly security scan** (`security.yml`): dedicated `npm audit --audit-level=high` run on a weekly schedule, independent of push triggers.

All three runtime dependencies (`better-sqlite3`, `uuid`, `zod`) are explicitly locked in `package-lock.json`. Dependabot is configured to open automated PRs for dependency updates on a weekly basis.

**Important limitation:** Vi-Harness does not provide kernel-level OS isolation (containers, microVMs). For production deployments running untrusted test suites, wrap the agent in a container or gVisor/Firecracker environment.
