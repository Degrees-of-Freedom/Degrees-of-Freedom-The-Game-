"""Command line: ``dof-structure-gan train|top``."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from .store import StructureStore
from .trainer import TrainConfig, Trainer

DEFAULT_DB = Path(__file__).resolve().parents[4] / "apps/web/public/structures/evolved.sqlite"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="dof-structure-gan", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    train = sub.add_parser("train", help="Run the adversarial loop and store excellent structures.")
    train.add_argument("--db", type=Path, default=DEFAULT_DB, help="SQLite file to append excellent structures to.")
    train.add_argument("--steps", type=int, default=200)
    train.add_argument("--seed", type=int, default=0)
    train.add_argument("--workers", type=int, default=1, help="Processes for the physics oracle.")
    train.add_argument("--device", default="cpu")
    train.add_argument("--log-every", type=int, default=10)
    top = sub.add_parser("top", help="List the best stored structures.")
    top.add_argument("--db", type=Path, default=DEFAULT_DB)
    top.add_argument("--limit", type=int, default=10)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    with StructureStore(args.db) as store:
        if args.command == "top":
            for row in store.top(args.limit):
                print(" ".join(f"{k}={row[k]:.2f}" if isinstance(row[k], float) else f"{k}={row[k]}" for k in row.keys()))
            return 0
        config = TrainConfig(steps=args.steps, seed=args.seed, workers=args.workers, log_every=args.log_every)
        before = len(store)
        Trainer(config, store, args.device).train()
        print(f"run {config.run_id}: {len(store) - before} new structures stored ({len(store)} total) in {args.db}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
