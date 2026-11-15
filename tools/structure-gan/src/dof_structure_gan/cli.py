"""Command line: ``dof-structure-gan train|top``."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from .physics import LoadCase
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
    train.add_argument("--checkpoint", type=Path, help="Directory for periodic and final checkpoints.")
    train.add_argument("--resume", action="store_true", help="Continue from --checkpoint if it exists.")
    train.add_argument("--both-wind-directions", action="store_true", help="Also check the reversed lateral push.")
    cal = sub.add_parser("calibrate-export", help="Write seed structures and oracle numbers for the game to re-check.")
    cal.add_argument("--out", type=Path, required=True)
    cal.add_argument("--count", type=int, default=600)
    cal.add_argument("--seed", type=int, default=0)
    exp = sub.add_parser("export-db", help="Export stored structures for the game's solver to re-check.")
    exp.add_argument("--db", type=Path, default=DEFAULT_DB)
    exp.add_argument("--out", type=Path, required=True)
    prune = sub.add_parser("prune-db", help="Delete stored structures the game's solver rejects.")
    prune.add_argument("--db", type=Path, default=DEFAULT_DB)
    prune.add_argument("--export", type=Path, required=True)
    prune.add_argument("--game", type=Path, required=True)
    rep = sub.add_parser("calibrate-report", help="Compare oracle numbers with the game's results.")
    rep.add_argument("--export", type=Path, required=True)
    rep.add_argument("--game", type=Path, required=True)
    top = sub.add_parser("top", help="List the best stored structures.")
    top.add_argument("--db", type=Path, default=DEFAULT_DB)
    top.add_argument("--limit", type=int, default=10)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    if args.command == "calibrate-export":
        from .calibration import export_seeds

        print(f"exported {export_seeds(args.out, args.count, args.seed)} structures to {args.out}")
        return 0
    if args.command == "export-db":
        from .calibration import export_database

        print(f"exported {export_database(args.db, args.out)} structures to {args.out}")
        return 0
    if args.command == "prune-db":
        from .calibration import prune_database

        print(f"removed {prune_database(args.db, args.export, args.game)} rejected structures from {args.db}")
        return 0
    if args.command == "calibrate-report":
        from .calibration import report

        print(report(args.export, args.game))
        return 0

    with StructureStore(args.db) as store:
        if args.command == "top":
            for row in store.top(args.limit):
                print(" ".join(f"{k}={row[k]:.2f}" if isinstance(row[k], float) else f"{k}={row[k]}" for k in row.keys()))
            return 0
        config = TrainConfig(
            steps=args.steps, seed=args.seed, workers=args.workers, log_every=args.log_every,
            load_case=LoadCase(both_wind_directions=args.both_wind_directions),
        )
        before = len(store)
        Trainer(config, store, args.device).train(args.checkpoint, args.resume)
        print(f"run {config.run_id}: {len(store) - before} new structures stored ({len(store)} total) in {args.db}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
