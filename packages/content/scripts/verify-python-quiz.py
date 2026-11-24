#!/usr/bin/env python3
"""Machine-verifies every `output` question in the Python quiz bank.

Usage (from packages/content):
    python3 scripts/verify-python-quiz.py [quiz/python/*.yaml]

YAML is parsed with the same `yaml` npm package the loader uses (via node), so
scalars are read exactly as the app reads them.

For each question with type `output`:
  * answer kind `output`        -> program exits 0 and stdout equals the stated text
                                   (exact, apart from one trailing newline); it is also
                                   run under two different PYTHONHASHSEED values, which
                                   must agree, so answers never depend on hash randomization.
  * answer kind `runtime_error` -> compiles, then exits non-zero with a traceback; the
                                   exception class named on the last stderr line must
                                   appear in the explanation.
  * answer kind `compile_error` -> compile() raises SyntaxError (so no code runs).
  * answer kind `unspecified`   -> compiles and runs; the output is shown but cannot be
                                   checked (the point of these is that it may vary).
  * answer kind `undefined`     -> rejected: it does not apply to Python.

Also checks for every question: topic == "python", id prefix "py-", unique ids,
and that `multiple` prompts say "select all that apply".
Exits non-zero on any failure.
"""

from __future__ import annotations

import glob
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CONTENT = os.path.dirname(HERE)
PYTHON = os.environ.get("PYTHON", "python3")
TIMEOUT = 20

LOAD_JS = """
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
const out = {};
for (const f of process.argv.slice(1)) out[f] = parse(readFileSync(f, 'utf8'));
process.stdout.write(JSON.stringify(out));
"""


def load(files: list[str]) -> dict[str, list[dict]]:
    res = subprocess.run(
        ["node", "--input-type=module", "-e", LOAD_JS, *files],
        cwd=CONTENT, capture_output=True, text=True, check=True,
    )
    return json.loads(res.stdout)


def run(path: str, seed: str) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if not k.startswith("PYTHON")}
    env["PYTHONHASHSEED"] = seed
    env["PYTHONIOENCODING"] = "utf-8"
    return subprocess.run(
        [PYTHON, "-I", path], capture_output=True, text=True, timeout=TIMEOUT,
        env=env, cwd=os.path.dirname(path),
    )


def compiles(path: str) -> tuple[bool, str]:
    checker = (
        "import sys\n"
        "src = open(sys.argv[1], encoding='utf-8').read()\n"
        "try:\n"
        "    compile(src, sys.argv[1], 'exec')\n"
        "except SyntaxError as e:\n"
        "    print(type(e).__name__ + ': ' + str(e)); sys.exit(3)\n"
    )
    res = subprocess.run([PYTHON, "-I", "-W", "ignore", "-c", checker, path],
                         capture_output=True, text=True, timeout=TIMEOUT)
    return res.returncode != 3, res.stdout.strip()


def strip1(s: str) -> str:
    return s[:-1] if s.endswith("\n") else s


def main() -> int:
    files = sys.argv[1:] or sorted(glob.glob(os.path.join(CONTENT, "quiz", "python", "*.yaml")))
    files = [os.path.abspath(f) for f in files]
    data = load(files)
    failures: list[str] = []
    seen: dict[str, str] = {}
    counts = {"output": 0, "runtime_error": 0, "compile_error": 0, "unspecified": 0}
    with tempfile.TemporaryDirectory() as tmp:
        for f in files:
            short = os.path.relpath(f, CONTENT)
            for q in data[f] or []:
                qid = q.get("id", "?")
                where = f"{short} {qid}"
                if qid in seen:
                    failures.append(f"{where}: duplicate id (also in {seen[qid]})")
                seen[qid] = short
                if q.get("topic") != "python":
                    failures.append(f"{where}: topic must be python")
                if not qid.startswith("py-"):
                    failures.append(f"{where}: id must start with py-")
                if q.get("type") == "multiple" and "select all that apply" not in q.get("prompt", "").lower():
                    failures.append(f"{where}: multiple-choice prompt must say 'select all that apply'")
                if q.get("type") != "output":
                    continue
                if q.get("language") != "python":
                    failures.append(f"{where}: language must be python")
                kind = q["answer"]["kind"]
                if kind not in counts:
                    failures.append(f"{where}: answer kind {kind!r} does not apply to Python")
                    continue
                counts[kind] += 1
                path = os.path.join(tmp, f"{qid.replace('-', '_')}.py")
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(q["code"])
                ok_compile, msg = compiles(path)
                if kind == "compile_error":
                    if ok_compile:
                        failures.append(f"{where}: expected SyntaxError at compile time, but it compiles")
                    continue
                if not ok_compile:
                    failures.append(f"{where}: unexpected SyntaxError: {msg}")
                    continue
                r1 = run(path, "0")
                if kind == "output":
                    r2 = run(path, "12345")
                    expected = strip1(q["answer"]["output"])
                    if r1.returncode != 0:
                        failures.append(f"{where}: exited {r1.returncode}\n{r1.stderr}")
                    elif strip1(r1.stdout) != expected:
                        failures.append(f"{where}: output mismatch\n--- expected\n{expected}\n--- actual\n{strip1(r1.stdout)}")
                    elif r2.stdout != r1.stdout:
                        failures.append(f"{where}: output depends on PYTHONHASHSEED")
                    if r1.stderr.strip():
                        print(f"note {where}: stderr: {r1.stderr.strip().splitlines()[-1]}")
                elif kind == "runtime_error":
                    last = (r1.stderr.strip().splitlines() or [""])[-1]
                    exc = last.split(":", 1)[0].strip().rsplit(".", 1)[-1]
                    if r1.returncode == 0 or "Traceback" not in r1.stderr:
                        failures.append(f"{where}: expected an uncaught exception, got exit {r1.returncode}")
                    elif exc not in q.get("explanation", ""):
                        failures.append(f"{where}: raises {exc} but the explanation does not name it")
                    else:
                        print(f"ok   {where}: raises {exc}")
                elif kind == "unspecified":
                    print(f"info {where}: (unspecified) this run printed {r1.stdout.strip()!r}, exit {r1.returncode}")
    total = sum(counts.values())
    print(f"\nchecked {total} output questions in {len(files)} files: {counts}; {len(seen)} questions in total")
    for fl in failures:
        print(f"FAIL {fl}")
    print("FAILED" if failures else "ALL OK")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
