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


@check("mm-game-coin-count")
def coin_count():
    # Every sequence of eight tosses, counting the heads.
    return figures(seq.count("H") for seq in itertools.product("HT", repeat=8))


@check("mm-game-min-three-d10")
def min_three_d10():
    return figures(min(roll) for roll in itertools.product(range(1, 11), repeat=3))


@check("mm-game-unequal-dice")
def unequal_dice():
    return figures(
        a + b + c for a, b, c in itertools.product(range(1, 5), range(1, 9), range(1, 21))
    )


@check("mm-game-three-cards")
def three_cards():
    # A full deck, card by card: ace 1, two to ten their number, jack, queen and king 10. Each of
    # the three cards comes from its own deck, so every triple of the 52 is equally likely.
    ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
    value = {r: 1 if r == "A" else 10 if r in "JQK" else int(r) for r in ranks}
    deck = [(r, s) for r in ranks for s in "SHDC"]
    return figures(
        sum(value[r] for r, _ in cards) for cards in itertools.product(deck, repeat=3)
    )


@check("mm-game-coin-knockout")
def coin_knockout():
    # The product of the dice if the coin is heads, nothing if tails.
    return figures(
        a * b if coin == "H" else 0
        for coin, a, b in itertools.product("HT", DIE, DIE)
    )


@check("mm-game-four-dice-informed")
def four_dice_informed():
    return figures(sum(roll) for roll in itertools.product(DIE, repeat=4))


@check("mm-game-inventory-d20")
def inventory_d20():
    return figures(
        a + b + c + e for a, b, c, e in itertools.product(DIE, DIE, DIE, range(1, 21))
    )
