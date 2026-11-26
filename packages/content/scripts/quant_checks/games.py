"""Checks for the market-making games (games/*.yaml): each recomputes the contract's figures
before anything is shown, from the game as its prompt describes it, by enumerating every outcome
with Fractions (never by calling or restating the TypeScript engine).

A check returns `GameFigures(fair, sd, min, max)`; verify-quant-quiz.py compares it with the
game's `expect` (fair, min and max exactly, sd to four significant figures). The content check
separately recomputes `expect` with the engine from the game's own components, so a game whose
YAML says something other than its prompt fails one side or the other.
"""

from __future__ import annotations

import itertools
import math
from fractions import Fraction

from . import GameFigures, check

DIE = range(1, 7)


def figures(outcomes) -> GameFigures:
    """Exact mean, standard deviation (as a float) and range of equally likely outcomes."""
    values = [Fraction(v) for v in outcomes]
    n = len(values)
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values) / n
    return GameFigures(fair=mean, sd=math.sqrt(var), min=min(values), max=max(values))


@check("mm-game-dice-sum")
def dice_sum():
    return figures(sum(roll) for roll in itertools.product(DIE, repeat=3))


@check("mm-game-dice-product")
def dice_product():
    return figures(a * b for a, b in itertools.product(DIE, repeat=2))
