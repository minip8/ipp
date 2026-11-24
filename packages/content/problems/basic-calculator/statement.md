Evaluate an arithmetic expression given as a string and return its integer value. Do not use `eval` or any library expression evaluator.

The expression contains:

- non-negative integer literals without leading zeros (e.g. `0`, `42`),
- the binary operators `+`, `-`, `*`, `/`,
- parentheses `(` and `)`,
- spaces, which can appear anywhere between tokens and should be ignored.

Rules:

- `*` and `/` bind tighter than `+` and `-`; operators of equal precedence are evaluated **left to right** (`8 - 3 - 2 = 3`, `12 / 3 * 2 = 8`).
- `/` is integer division **truncating toward zero** (`7 / 2 = 3`, `-7 / 2 = -3`).
- A **unary minus** may appear at the very start of the expression or directly after an opening parenthesis, negating the term that follows: `-3 * 2 = -6`, `2 - (-4 + 1) = 5`. Unary plus does not occur.
- The expression is always valid, never divides by zero, and every intermediate value (every sub-expression, sum and product) fits in a signed 32-bit integer.

**Examples**

```
s = "1 + 2 * 3"             ->   7
s = "(1+2)*3"               ->   9
s = "-(5 - 12) / 2"         ->   3       -(-7) = 7, then 7 / 2 = 3
s = "2*(3+(4-10)/4)"        ->   4       (4 - 10) / 4 = -1 (truncation), 3 + -1 = 2, 2 * 2 = 4
s = "100 - 2 * 3 - 4"       ->   90
```

**Constraints**

- `1 <= s.length <= 2 * 10^4`
- Parentheses are nested at most 100 deep.
