You are told some ratios between unknown positive quantities. `equations[i] = [A, B]` together with `values[i] = k` means `A / B = k`. Each quantity is named by a string.

For each query `queries[j] = [C, D]`, return the value of `C / D` if it can be derived from the given ratios by multiplying and dividing them, or `-1.0` if it cannot.

Details:

- If `C` or `D` never appears in any equation, the answer is `-1.0` — even when `C == D`.
- If `C == D` and the name appears in some equation, the answer is `1.0`.
- If `C` and `D` both appear but are not linked by any chain of equations, the answer is `-1.0`.

The given ratios never contradict each other. Answers are compared with a tolerance of `1e-6` (absolute or relative).

**Example**

```
equations = [["usd", "eur"], ["eur", "gbp"], ["yen", "cny"]]
values    = [1.25, 1.2, 0.05]
queries   = [["usd", "gbp"], ["gbp", "usd"], ["usd", "yen"], ["eur", "eur"], ["btc", "btc"], ["cny", "yen"]]
->          [1.5, 0.6666667, -1.0, 1.0, -1.0, 20.0]
```

`usd / gbp = (usd / eur) * (eur / gbp) = 1.25 * 1.2 = 1.5`. `usd` and `yen` are in unrelated groups. `btc` never appears.

**Constraints**

- `1 <= equations.length <= 2000`, `values.length == equations.length`
- `1 <= queries.length <= 2000`
- Names are 1–8 lowercase letters or digits; `A != B` within an equation.
- `0.01 <= values[i] <= 100`; all derivable answers lie between `10^-9` and `10^9`.
