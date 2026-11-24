**Approaches**
- Expected: a stack of integers. Push numbers; on an operator pop `b` then `a` and push `a op b`. The single remaining value is the answer. O(n) time, O(n) space.
- Recursive evaluation from the end (each operator consumes the two sub-expressions before it) — same complexity, worth mentioning.

**Common wrong turns**
- Operand order for `-` and `/` (popping `a` first gives `b - a`).
- Detecting operators with "first char is `-`" — `"-7"` is a number. Compare the whole token.
- Python `//` floors (`-7 // 2 == -4`); need truncation toward zero, e.g. `int(a / b)` (OK for 32-bit values) or sign-aware integer division.
- In C++, `INT_MIN / -1` overflows — excluded by the constraints here, but a good follow-up.

**Hint ladder**
1. When you reach an operator, where are its operands?
2. What data structure gives you the two most recent unconsumed values?
3. Push numbers; on an operator pop two, combine (mind the order), push the result.

**Follow-ups**
- Convert infix to RPN (shunting-yard), handling precedence and parentheses.
- Validate the input: report malformed expressions (too few operands, leftovers).
- Add unary minus or exponentiation (right-associative) — what changes?
