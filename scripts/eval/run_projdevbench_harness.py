#!/usr/bin/env python3
"""
ProjDevBench / SWE-bench Upstream Runner Adapter for Vi-Harness.

This script adheres to the standard upstream evaluation protocol:
- Iterates over benchmark problems/instances from a dataset file (.json or .jsonl) or directory.
- Prepares problem workspace.
- Runs `vi-harness solve` with headless JSONL streaming and patch export (`--output-patch`).
- Aggregates outputs into the canonical `predictions.jsonl` format:
    {"instance_id": "<id>", "model_patch": "<git diff>", "model_name_or_path": "<model>"}
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Vi-Harness Upstream Benchmark Evaluation Adapter"
    )
    parser.add_argument(
        "--dataset",
        type=str,
        default=None,
        help="Path to benchmark dataset file (.json, .jsonl) or tasks directory",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="benchmark-results/upstream-predictions",
        help="Directory to write patches and predictions.jsonl",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=os.environ.get("MODEL_ID", "gpt-4o"),
        help="Model ID to evaluate",
    )
    parser.add_argument(
        "--provider-id",
        type=str,
        default=os.environ.get("PROVIDER_ID", "openai-compatible"),
        help="Provider ID (mock, openrouter, openai-compatible)",
    )
    parser.add_argument(
        "--base-url",
        type=str,
        default=os.environ.get("OPENROUTER_BASE_URL", os.environ.get("OPENAI_BASE_URL", None)),
        help="API Base URL",
    )
    parser.add_argument(
        "--api-key",
        type=str,
        default=os.environ.get("OPENROUTER_API_KEY", os.environ.get("OPENAI_API_KEY", None)),
        help="API key",
    )
    parser.add_argument(
        "--max-iterations",
        type=int,
        default=30,
        help="Max loop iterations per task",
    )
    parser.add_argument(
        "--timeout-sec",
        type=int,
        default=300,
        help="Execution timeout per problem in seconds",
    )
    parser.add_argument(
        "--node-bin",
        type=str,
        default="node",
        help="Node.js binary executable",
    )
    parser.add_argument(
        "--harness-bin",
        type=str,
        default=None,
        help="Path to vi-harness executable or bin/vi-harness.js",
    )
    return parser.parse_args()


def resolve_harness_cmd(node_bin: str, harness_bin: Optional[str]) -> List[str]:
    if harness_bin and os.path.exists(harness_bin):
        if harness_bin.endswith(".js"):
            return [node_bin, harness_bin]
        return [harness_bin]

    repo_root = Path(__file__).resolve().parent.parent.parent
    local_bin = repo_root / "bin" / "vi-harness.js"
    if local_bin.exists():
        return [node_bin, str(local_bin)]

    # Fallback to globally installed vi-harness in PATH
    return ["vi-harness"]


def run_instance(
    instance: Dict[str, Any],
    harness_cmd: List[str],
    output_dir: Path,
    args: argparse.Namespace,
) -> Dict[str, Any]:
    instance_id = instance.get("instance_id") or instance.get("id") or instance.get("problem_id", "unknown")
    prompt = instance.get("problem_statement") or instance.get("prompt") or instance.get("description", "")
    workspace_dir = instance.get("workspace_dir") or instance.get("repo_dir") or os.getcwd()

    patch_file = output_dir / f"{instance_id}.patch"

    cmd = harness_cmd + [
        "solve",
        "-p", prompt,
        "--cwd", str(workspace_dir),
        "--model", args.model,
        "--provider-id", args.provider_id,
        "--output-patch", str(patch_file),
        "--mode", "jsonl",
        "--max-iterations", str(args.max_iterations),
    ]

    if args.base_url:
        cmd += ["--base-url", args.base_url]
    if args.api_key:
        cmd += ["--api-key", args.api_key]

    start_time = time.time()
    print(f"\n🚀 Running instance: {instance_id}")

    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=args.timeout_sec,
        )
        duration_sec = time.time() - start_time
        success = proc.returncode == 0
    except subprocess.TimeoutExpired:
        duration_sec = time.time() - start_time
        success = False
        print(f"⏱️ Instance {instance_id} timed out after {args.timeout_sec}s")

    model_patch = ""
    if patch_file.exists():
        try:
            model_patch = patch_file.read_text(encoding="utf-8")
        except Exception:
            pass

    prediction = {
        "instance_id": instance_id,
        "model_patch": model_patch,
        "model_name_or_path": args.model,
        "duration_seconds": round(duration_sec, 2),
        "exit_code": 0 if success else 1,
    }

    status_icon = "✅" if success else "❌"
    print(f"{status_icon} Instance {instance_id} finished in {duration_sec:.1f}s (patch: {len(model_patch)} bytes)")
    return prediction


def main():
    args = parse_args()
    output_path = Path(args.output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    harness_cmd = resolve_harness_cmd(args.node_bin, args.harness_bin)
    print(f"Vi-Harness Upstream Adapter initialized.")
    print(f"Harness command: {' '.join(harness_cmd)}")
    print(f"Output directory: {output_path}")

    instances: List[Dict[str, Any]] = []

    if args.dataset and os.path.exists(args.dataset):
        dataset_path = Path(args.dataset)
        if dataset_path.is_file():
            if dataset_path.suffix == ".jsonl":
                with open(dataset_path, "r", encoding="utf-8") as f:
                    for line in f:
                        if line.strip():
                            instances.append(json.loads(line))
            elif dataset_path.suffix == ".json":
                with open(dataset_path, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                    instances = raw if isinstance(raw, list) else [raw]
    else:
        # Default smoke benchmark instance
        instances = [{
            "instance_id": "smoke-test-001",
            "prompt": "Verify repository builds with zero warnings",
            "workspace_dir": os.getcwd(),
        }]

    print(f"Loaded {len(instances)} instance(s) to evaluate.")
    predictions: List[Dict[str, Any]] = []

    predictions_file = output_path / "predictions.jsonl"
    with open(predictions_file, "w", encoding="utf-8") as out_f:
        for inst in instances:
            pred = run_instance(inst, harness_cmd, output_path, args)
            predictions.append(pred)
            out_f.write(json.dumps(pred) + "\n")
            out_f.flush()

    total = len(predictions)
    passed = sum(1 for p in predictions if p["exit_code"] == 0)
    print("\n" + "=" * 50)
    print(f"Benchmark Run Completed:")
    print(f"Total Instances : {total}")
    print(f"Successful Tasks: {passed}/{total} ({(passed/total*100) if total else 0:.1f}%)")
    print(f"Predictions file: {predictions_file}")
    print("=" * 50)


if __name__ == "__main__":
    main()
