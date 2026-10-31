#!/usr/bin/env python3
"""Compare UTF-8 instruction file sizes without modifying or printing content."""

import argparse
import hashlib
import json
import sys
from pathlib import Path


def measure(path):
    raw = path.read_bytes()
    text = raw.decode("utf-8")
    return {
        "path": str(path.resolve()),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "utf8_bytes": len(raw),
        "characters": len(text),
        "lines": len(text.splitlines()),
    }


def compare(before, after):
    changes = {}
    for metric in ("utf8_bytes", "characters", "lines"):
        original = before[metric]
        delta = after[metric] - original
        changes[metric] = {
            "delta": delta,
            "change_percent": round(delta / original * 100, 2) if original else None,
        }
    return {
        "before": before,
        "after": after,
        "changes": changes,
        "limits": "File sizes only; not token counts, semantic checks, or performance measurements.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    args = parser.parse_args()
    try:
        result = compare(measure(args.before), measure(args.after))
    except (OSError, UnicodeError) as error:
        print(f"Cannot compare UTF-8 files ({type(error).__name__}).", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
