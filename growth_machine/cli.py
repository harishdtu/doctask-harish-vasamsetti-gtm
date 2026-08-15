"""
CLI.

SAFETY: DRY_RUN=true and SEND_MESSAGES=false always. There is no flag,
env var, or code path in this CLI that sends a message anywhere. This
is intentional and is checked by tests/test_safety.py.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .pipeline import run_batch

# Hard-coded safety posture. Not configurable by design -- see README.
DRY_RUN = True
SEND_MESSAGES = False


def _print_safety_banner() -> None:
    print("=" * 60)
    print(" growth_machine -- SAFE DEMONSTRATION MODE")
    print(f" DRY_RUN={DRY_RUN}  SEND_MESSAGES={SEND_MESSAGES}")
    print(" No message is ever sent. Outputs are drafts on disk only.")
    print("=" * 60)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="growth_machine")
    sub = parser.add_subparsers(dest="command", required=True)

    run_p = sub.add_parser("run", help="Run the growth machine for one batch")
    run_p.add_argument("--batch", required=True, help="Batch id, e.g. run_001")
    run_p.add_argument("--count", type=int, default=12, help="Synthetic targets to generate (ignored in public mode)")
    run_p.add_argument("--seed", type=int, default=None, help="Override RNG seed (default: derived from --batch)")
    run_p.add_argument("--input", default=None, help="Optional path to a public_targets.json for public mode")
    run_p.add_argument("--output", default=None, help="Output directory (default: outputs/<batch>)")

    args = parser.parse_args(argv)

    if args.command == "run":
        _print_safety_banner()
        output_dir = args.output or os.path.join("outputs", args.batch)
        m = run_batch(
            batch_id=args.batch,
            output_dir=output_dir,
            count=args.count,
            seed=args.seed,
            public_input_path=args.input,
        )
        print(f"\nBatch '{args.batch}' complete. Output: {output_dir}")
        print(json.dumps(m.to_dict(), indent=2))
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
