#!/usr/bin/env python3
"""Recomputes the answers of the quant quiz topics.

Usage (from packages/content):
    python3 scripts/verify-quant-quiz.py [topic ...]

With no arguments it takes every topic whose `track` is `quant` in quiz/topics.yaml. Questions
are read by scripts/quant-dump.ts, so they are parsed by the same schema as the app and a
numeric answer arrives as an exact rational. The checks live in scripts/quant_checks/<topic>.py
(hyphens become underscores); scripts/quant_checks/__init__.py says what a check returns.

Fails when: a file does not parse, a `numeric` question has no check, a check names a question
that does not exist, a check raises, or a check disagrees with the authored answer.
"""

from __future__ import annotations

import importlib
import json
import math
import os
import subprocess
import sys
from collections import Counter
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
CONTENT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import quant_checks  # noqa: E402
from quant_checks import Simulated  # noqa: E402

FLOAT_REL = 5e-6
SIM_SIGMAS = 4.0
SIM_MAX_REL_STDERR = 0.01


def quant_topics() -> list[str]:
    js = (
        "import {readFileSync} from 'node:fs'; import {parse} from 'yaml';"
        "const t = parse(readFileSync('quiz/topics.yaml','utf8'));"
        "console.log(JSON.stringify(t.filter(x => x.track === 'quant').map(x => x.slug)));"
    )
    out = subprocess.run(
        ["node", "--input-type=module", "-e", js], cwd=CONTENT, capture_output=True, text=True, check=True
    )
    return json.loads(out.stdout)


def dump(topics: list[str]) -> list[dict]:
    tsx = os.path.join(CONTENT, "node_modules", ".bin", "tsx")
    out = subprocess.run([tsx, "scripts/quant-dump.ts", *topics], cwd=CONTENT, capture_output=True, text=True)
    sys.stderr.write(out.stderr)
    if out.returncode != 0:
        sys.exit("quant-dump failed: fix the files above first")
    return json.loads(out.stdout)


def within(answer: Fraction, value: float, tolerance: dict | None, default_rel: float) -> bool:
    diff = abs(float(answer) - value)
    if tolerance:
        return diff <= max(tolerance.get("abs") or 0.0, (tolerance.get("rel") or 0.0) * abs(float(answer)))
    return diff <= default_rel * max(abs(value), 1e-12)


def compare(q: dict, result: object) -> str | None:
    """None when the check agrees with the authored answer, else what is wrong."""
    kind = q["type"]
    if result is None:
        return None
    if kind == "numeric":
        answer = Fraction(int(q["answer"]["num"]), int(q["answer"]["den"]))
        shown = q["answer"]["text"]
        if isinstance(result, bool):
            return "check returned a bool"
        if isinstance(result, (int, Fraction)):
            exact = Fraction(result)
            if q["tolerance"]:
                ok = within(answer, float(exact), q["tolerance"], FLOAT_REL)
            else:
                ok = exact == answer
            return None if ok else f"answer is {shown}, check computed exactly {exact} (= {float(exact):.9g})"
        if isinstance(result, float):
            if not math.isfinite(result):
                return f"check returned {result}"
            ok = within(answer, result, q["tolerance"], FLOAT_REL)
            return None if ok else f"answer is {shown} (= {float(answer):.9g}), check computed {result:.9g}"
        if isinstance(result, Simulated):
            scale = max(abs(float(answer)), 1e-12)
            if result.stderr > SIM_MAX_REL_STDERR * scale:
                return (
                    f"simulation too noisy: stderr {result.stderr:.3g} on an answer of {float(answer):.6g}; "
                    "raise n or check exactly"
                )
            ok = abs(result.mean - float(answer)) <= SIM_SIGMAS * result.stderr
            return (
                None
                if ok
                else f"answer is {shown} (= {float(answer):.6g}), simulated {result.mean:.6g} ± {result.stderr:.2g}"
            )
        return f"a numeric check returns int, Fraction, float or Simulated, not {type(result).__name__}"
    if kind == "single":
        if not isinstance(result, str):
            return f"a single-choice check returns the choice id (str), not {type(result).__name__}"
        return None if result == q["answer"] else f"answer is choice {q['answer']!r}, check picked {result!r}"
    if kind == "multiple":
        if isinstance(result, str) or not isinstance(result, (set, frozenset, list, tuple)):
            return f"a multiple-choice check returns the choice ids, not {type(result).__name__}"
        picked = sorted(result)
        return None if picked == q["answer"] else f"answer is {q['answer']}, check picked {picked}"
    return f"a check of a {kind} question must return None (assert inside it)"


def main() -> int:
    topics = sys.argv[1:] or quant_topics()
    if not topics:
        print("no quant topics")
        return 0
    questions = dump(topics)
    by_id = {q["id"]: q for q in questions}
    failures: list[str] = []

    for topic in topics:
        module = f"quant_checks.{topic.replace('-', '_')}"
        try:
            importlib.import_module(module)
        except ModuleNotFoundError as e:
            if e.name != module:
                raise
            failures.append(f"{topic}: no scripts/quant_checks/{topic.replace('-', '_')}.py")

    checked: Counter[str] = Counter()
    for qid, fn in quant_checks.CHECKS.items():
        q = by_id.get(qid)
        if q is None:
            failures.append(f"{qid}: check for a question that is not in {', '.join(topics)}")
            continue
        try:
            problem = compare(q, fn())
        except Exception as e:  # a failed assert or a bug in the check
            problem = f"check raised {type(e).__name__}: {e}"
        if problem:
            failures.append(f"{qid} ({q['file']}): {problem}")
        else:
            checked[q["topic"]] += 1

    for q in questions:
        if q["type"] == "numeric" and q["id"] not in quant_checks.CHECKS:
            failures.append(f"{q['id']} ({q['file']}): numeric question without a check")

    for topic in topics:
        mine = [q for q in questions if q["topic"] == topic]
        types = Counter(q["type"] for q in mine)
        print(f"{topic}: {len(mine)} questions {dict(types)}, {checked[topic]} checks passed")
    for f in failures:
        print(f"FAIL {f}")
    print("ok" if not failures else f"{len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
