"""interview++ judge: Python driver (baked into the sandbox image).

Loads /work/solution.py (the candidate's file with top-level side effects already removed by the
judge), then runs tests that arrive one per line on fd 3 and reports results as nonce-framed JSON on
stdout. Protocol: see apps/judge/README.md. Extra frames for Python:
  {"t":"compile_error","error":"..."}   the file does not compile (SyntaxError and friends)
  {"t":"init_error","error":"..."}      executing the module or finding the class failed
"""

import json
import linecache
import math
import os
import resource
import sys
import time
import traceback

SOLUTION = "solution.py"


def _write(fd, data):
    view = memoryview(data)
    while view:
        n = os.write(fd, view)
        view = view[n:]


class Out:
    def __init__(self, nonce):
        self.marker = ("\x1eIPP" + nonce + "\x1f").encode()

    def emit(self, obj):
        for stream in (sys.stdout, sys.stderr, sys.__stdout__, sys.__stderr__):
            try:
                stream.flush()
            except Exception:
                pass
        body = json.dumps(obj, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        _write(1, self.marker + body.encode("utf-8", "replace") + b"\n")


def candidate_traceback(exc):
    """The exception with only the candidate's own frames, so driver code is never shown."""
    frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename == SOLUTION]
    lines = []
    if frames:
        lines.append("Traceback (most recent call last):\n")
        lines.extend(traceback.format_list(frames))
    lines.extend(traceback.format_exception_only(type(exc), exc))
    return "".join(lines).rstrip("\n")


def to_float(ty, v):
    if ty == "double" and isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    if isinstance(ty, dict) and isinstance(v, list):
        inner = ty.get("array", ty.get("list"))
        return [to_float(inner, x) for x in v]
    return v


def convert_args(types, args):
    if types is None or len(types) != len(args):
        return list(args)
    return [to_float(t, a) for t, a in zip(types, args)]


class Unsupported(Exception):
    pass


def encode(v):
    if v is None or isinstance(v, (bool, str)):
        return v
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    if isinstance(v, (list, tuple)):
        return [encode(x) for x in v]
    if isinstance(v, (set, frozenset)):
        return [encode(x) for x in v]
    if hasattr(v, "__iter__") and not isinstance(v, (dict, bytes)):
        return [encode(x) for x in v]
    raise Unsupported("cannot convert a return value of type %s to the expected result" % type(v).__name__)


def main():
    chan = os.fdopen(3, "rb")
    header = json.loads(chan.readline())
    out = Out(header["nonce"])
    class_name = header["className"]
    ctor_types = header.get("ctorTypes")
    method_types = header.get("methodTypes", {})

    with open(SOLUTION, encoding="utf-8", errors="replace") as f:
        src = f.read()
    linecache.cache[SOLUTION] = (len(src), None, src.splitlines(True), SOLUTION)
    try:
        code = compile(src, SOLUTION, "exec")
    except (SyntaxError, ValueError) as e:
        out.emit({"t": "compile_error", "error": "".join(traceback.format_exception_only(type(e), e)).rstrip("\n")})
        return
    sys.setrecursionlimit(max(sys.getrecursionlimit(), int(header.get("recursionLimit", 100000))))
    ns = {"__name__": "solution", "__file__": SOLUTION, "__builtins__": __builtins__}
    try:
        exec(code, ns)
    except BaseException as e:  # noqa: BLE001 - anything the module does at import time
        out.emit({"t": "init_error", "error": candidate_traceback(e)})
        return
    cls = ns.get(class_name)
    if not isinstance(cls, type):
        out.emit({"t": "init_error", "error": "class %s is not defined" % class_name})
        return
    out.emit({"t": "ready"})

    for line in chan:
        if not line.strip():
            continue
        test = json.loads(line)
        ns_total = 0
        frame = None
        try:
            args = convert_args(ctor_types, test["ctorArgs"])
            t0 = time.perf_counter_ns()
            obj = cls(*args)
            ns_total += time.perf_counter_ns() - t0
            values = []
            for call in test["calls"]:
                name = call["method"]
                fn = getattr(obj, name)
                cargs = convert_args(method_types.get(name), call["args"])
                t0 = time.perf_counter_ns()
                r = fn(*cargs)
                ns_total += time.perf_counter_ns() - t0
                values.append(encode(r))
            frame = {"t": "result", "ok": True, "values": values}
        except MemoryError as e:
            frame = {"t": "result", "ok": False, "kind": "memory", "error": candidate_traceback(e)}
        except Unsupported as e:
            frame = {"t": "result", "ok": False, "kind": "exception", "error": str(e)}
        except BaseException as e:  # noqa: BLE001 - includes SystemExit from exit() in candidate code
            frame = {"t": "result", "ok": False, "kind": "exception", "error": candidate_traceback(e)}
        frame["ms"] = ns_total / 1e6
        frame["rssKb"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        try:
            out.emit(frame)
        except (ValueError, TypeError) as e:
            out.emit({"t": "result", "ok": False, "kind": "exception", "error": "cannot encode result: %s" % e,
                      "ms": frame["ms"], "rssKb": frame["rssKb"]})


if __name__ == "__main__":
    main()
