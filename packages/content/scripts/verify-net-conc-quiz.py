#!/usr/bin/env python3
"""Compile and run every `output` question in quiz/networking and quiz/concurrency.

    python3 packages/content/scripts/verify-net-conc-quiz.py [--runs N] [--only ID_SUBSTRING]

C++: compiled with g++ and clang++ (one compile at a time; the machine is short on memory) using
-std=<question standard> -pthread -O2, then run N times. Python: run N times with python3.

  kind=output        stdout (trimmed, whitespace collapsed) must match on every run and compiler
  kind=compile_error both compilers must reject the program
  kind=runtime_error python must exit non-zero
  kind=undefined     C++: additionally built with -fsanitize=thread; reports whether TSan flagged a
                     race or the program hung (e.g. self-deadlock). Informational, never a failure.
  kind=unspecified   compiled and run; the distinct outputs observed are listed.
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DIRS = [ROOT / 'quiz' / 'networking', ROOT / 'quiz' / 'concurrency']
TIMEOUT = 20


def norm(s: str) -> str:
    return ' '.join(s.split())


def std_flag(standard: str) -> str:
    m = re.search(r'C\+\+\s*(\d+)', standard)
    return f'-std=c++{m.group(1) if m else "20"}'


def run(cmd, timeout=TIMEOUT):
    # symbolize=0: llvm-symbolizer crashes on some hosts and the raw report is enough to detect a race
    env = {**os.environ, 'TSAN_OPTIONS': 'symbolize=0'}
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)
        return p.returncode, p.stdout, p.stderr, False
    except subprocess.TimeoutExpired as e:
        out = e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or '')
        return None, out, '', True


def check_cpp(q, work: Path, runs: int):
    src = work / f"{q['id']}.cpp"
    src.write_text(q['code'])
    kind = q['answer']['kind']
    problems, notes, seen = [], [], set()
    for cxx in ('g++', 'clang++'):
        exe = work / f"{q['id']}-{cxx}"
        rc, _, err, _ = run([cxx, std_flag(q['standard']), '-pthread', '-O2', '-w', str(src), '-o', str(exe)], 300)
        if kind == 'compile_error':
            if rc == 0:
                problems.append(f'{cxx}: compiled but expected compile_error')
            continue
        if rc != 0:
            problems.append(f'{cxx}: compile failed\n{err[:2000]}')
            continue
        if kind == 'undefined':
            rc, out, _, hung = run([str(exe)], 5)
            seen.add('<hang>' if hung else norm(out))
            continue
        for _ in range(runs):
            rc, out, err, hung = run([str(exe)])
            got = '<hang>' if hung else norm(out)
            seen.add(got)
            if kind == 'output' and got != norm(q['answer']['output']):
                problems.append(f'{cxx}: got {got!r}, expected {norm(q["answer"]["output"])!r}')
                break
    if kind == 'undefined':
        exe = work / f"{q['id']}-tsan"
        rc, _, err, _ = run(['clang++', std_flag(q['standard']), '-pthread', '-O1', '-g', '-w', '-fsanitize=thread', str(src), '-o', str(exe)], 300)
        if rc == 0:
            rc, out, err, hung = run([str(exe)], 5)
            if 'ThreadSanitizer' in err:
                first = next((l for l in err.splitlines() if 'WARNING: ThreadSanitizer' in l), 'report')
                notes.append(f'tsan: {first.strip()}')
            elif hung:
                notes.append('tsan build hung (e.g. self-deadlock)')
            else:
                notes.append('tsan: no report (UB claim rests on the standard, not the sanitizer)')
        notes.append(f'observed: {sorted(seen)}')
    if kind == 'unspecified':
        notes.append(f'observed: {sorted(seen)}')
    return problems, notes


def check_python(q, work: Path, runs: int):
    src = work / f"{q['id']}.py"
    src.write_text(q['code'])
    kind = q['answer']['kind']
    problems, seen = [], set()
    for _ in range(runs):
        rc, out, err, hung = run([sys.executable, '-I', str(src)])
        got = '<hang>' if hung else norm(out)
        seen.add(got)
        if kind == 'output':
            if rc != 0:
                problems.append(f'exit {rc}: {err[-1000:]}')
                break
            if got != norm(q['answer']['output']):
                problems.append(f'got {got!r}, expected {norm(q["answer"]["output"])!r}')
                break
        elif kind == 'runtime_error' and rc == 0:
            problems.append('exited 0 but expected runtime_error')
            break
    return problems, ([f'observed: {sorted(seen)}'] if kind in ('unspecified', 'undefined') else [])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--runs', type=int, default=5)
    ap.add_argument('--only', default='')
    args = ap.parse_args()
    questions = []
    for d in DIRS:
        if not d.is_dir():
            print(f'skip {d.relative_to(ROOT)} (missing)')
            continue
        for f in sorted(d.glob('*.yaml')):
            for q in yaml.safe_load(f.read_text()) or []:
                if q.get('type') == 'output' and args.only in q['id']:
                    questions.append(q)
    failed = 0
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for q in questions:
            check = check_cpp if q['language'] == 'cpp' else check_python
            if q['language'] not in ('cpp', 'python'):
                print(f"skip {q['id']}: language {q['language']}")
                continue
            problems, notes = check(q, work, args.runs)
            status = 'FAIL' if problems else 'ok  '
            failed += bool(problems)
            print(f"{status} {q['id']} [{q['answer']['kind']}]")
            for line in problems + notes:
                print(f'       {line}')
    print(f'\n{len(questions) - failed}/{len(questions)} output questions verified')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
