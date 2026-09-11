#!/usr/bin/env python3
"""
mock-judge.py — Simulates a SWE-bench-style judge for the swe-bench-harness example.

Verdict logic:
  - If a file named "solution.ts" exists and contains "export function", exit 0 (AC).
  - Otherwise exit 1 (WA) with a diagnostic message.

Usage:
  python mock-judge.py [--workspace /path/to/workspace]
"""
import sys
import os
import argparse

parser = argparse.ArgumentParser(description="Mock SWE-bench judge")
parser.add_argument("--workspace", default=".", help="Path to the workspace")
args = parser.parse_args()

solution_path = os.path.join(args.workspace, "solution.ts")

if os.path.isfile(solution_path):
    content = open(solution_path).read()
    if "export function" in content:
        print("VERDICT: AC")
        print("All test cases passed.")
        sys.exit(0)
    else:
        print("VERDICT: CE")
        print("Compilation Error: solution.ts must export at least one function.")
        sys.exit(1)
else:
    print("VERDICT: WA")
    print("Wrong Answer: solution.ts not found in workspace.")
    print(f"Expected file: {solution_path}")
    sys.exit(1)
