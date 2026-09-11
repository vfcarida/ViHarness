# Example: SWE-bench Harness Integration

This example demonstrates running Vi-Harness against a **SWE-bench-style evaluation harness** using the `--judge-command` and `--output-patch` flags.

The example includes:
- A mock judge script (`mock-judge.py`) that simulates a SWE-bench-style verdict pipeline.
- A complete end-to-end `solve` invocation with judge integration.
- Patch export to the `predictions/` directory.

## What This Example Demonstrates

1. **`--judge-command`** — Connect any external oracle command to the solve loop.
2. **`--max-judge-retries`** — Control the iterative repair budget.
3. **`--output-patch`** — Export git diff patches for offline evaluation.
4. **Judge verdict parsing** — `AC`, `WA`, `CE`, `TLE` verdict handling.
5. **`ScriptedModelProvider`** — Deterministic, offline simulation of a full judge repair cycle.

## Run

```bash
# From the repository root — no API key required
npx tsx examples/swe-bench-harness/index.ts
```

## Real SWE-bench Integration

To connect to a real SWE-bench Docker eval harness:

```bash
vi-harness solve \
  -p "Fix the bug described in the issue" \
  --cwd /path/to/repo \
  --judge-command "python eval/run_tests.py --instance-id django__django-1234" \
  --max-judge-retries 3 \
  --output-patch ./predictions/django__django-1234.patch
```

The judge command can be any executable that:
- Exits 0 on success (interpreted as `AC`)
- Exits non-zero on failure (interpreted as `WA`/`CE`)
- Writes verdict information to stdout/stderr
