"""Independent recomputations of quant quiz answers, one module per topic, and of the figures
of the market-making games (games/*.yaml) in games.py.

A check is a function registered under a question id. What it returns says how it is compared
with the authored answer (see scripts/verify-quant-quiz.py):

    int / Fraction   the exact value: the answer must be this rational
    float            a closed form evaluated in floating point (math.exp(-1)): the answer must
                     agree to six significant figures, or to the question's own tolerance
    Simulated        a Monte Carlo estimate (use `simulate`): the answer must be within four
                     standard errors, and the standard error must be under 1% of the answer
    str              the id of the right choice of a `single` question
    set / list       the ids of the right choices of a `multiple` question
    None             the check only asserts (a `short` question's facts and figures)
    GameFigures      a game's fair value and standard deviation (and, optionally, its minimum and
                     maximum), each an exact value, a float or a Simulated as above, compared with
                     the game's `expect`; an sd as a float must agree to four significant figures

Every `numeric` question and every game needs a check. A check is worth having only when it does not repeat
the explanation's own derivation: enumerate the sample space with Fractions, run the recurrence
or the dynamic programme, or simulate, so that a slip in the algebra is caught.

Standard library only (fractions, itertools, math, random, statistics, functools).
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from fractions import Fraction
from typing import Callable

CHECKS: dict[str, Callable[[], object]] = {}


def check(question_id: str):
    """Registers the decorated function as the check of `question_id`."""

    def register(fn: Callable[[], object]):
        if question_id in CHECKS:
            raise ValueError(f"two checks for {question_id}")
        CHECKS[question_id] = fn
        return fn

    return register


@dataclass(frozen=True)
class Simulated:
    mean: float
    stderr: float
    trials: int


@dataclass(frozen=True)
class GameFigures:
    """What a game's check returns: its contract before anything is shown."""

    fair: object
    sd: object
    min: object = None
    max: object = None


def simulate(trial: Callable[[random.Random], float], n: int = 200_000, seed: int = 20260101) -> Simulated:
    """Mean of `trial(rng)` over `n` seeded runs, with its standard error.

    `trial` returns a number (an indicator 0/1 for a probability). The seed is fixed so the
    script is reproducible.
    """
    rng = random.Random(seed)
    total = 0.0
    total_sq = 0.0
    for _ in range(n):
        x = float(trial(rng))
        total += x
        total_sq += x * x
    mean = total / n
    var = max(total_sq / n - mean * mean, 0.0)
    return Simulated(mean, math.sqrt(var / n), n)


__all__ = ["CHECKS", "Fraction", "GameFigures", "Simulated", "check", "simulate"]
