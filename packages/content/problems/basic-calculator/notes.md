**Approaches**
- Expected (recursive descent): grammar `expr := ['-'] term (('+' | '-') term)*`, `term := factor (('*' | '/') factor)*`, `factor := number | '(' expr ')'`. One function per level with a shared index. O(n) time, O(depth) stack. Easy to extend and reason about.
- Stack-based single pass (the LeetCode 227 trick) extended with recursion or an explicit stack for parentheses: keep a stack of signed terms; on `*`/`/` combine with the top; at the end sum the stack. O(n).
- Shunting-yard to RPN, then evaluate. O(n), more machinery, but handles any precedence table.

**Common wrong turns**
- Right-associative evaluation of `-` and `/` (`8 - 3 - 2` -> 7, `12 / 3 * 2` -> 2) — common with naive recursion `expr := term ('+'|'-') expr`.
- Python `//` floors: `-7 // 2 == -4`. Need truncation toward zero.
- Unary minus: treating `-(5 - 12)` as `0 - 5 - 12`, or forgetting it applies to the whole following term (`-3 * 2`).
- Multi-digit numbers and spaces between tokens.
- With the "stack of terms" approach, applying `/` to an already-negated term — fine with truncation symmetry, but candidates should be able to argue why `(-a) / b == -(a / b)` under truncation.

**Hint ladder**
1. Write down a grammar with one rule per precedence level. What does a "factor" look like?
2. How do left-to-right loops at each level give you left associativity?
3. Where does a parenthesised sub-expression fit in, and how does the recursion return to the right position in the string?

**Follow-ups**
- Add variables (`"a * (b + 2)"` with a map), exponentiation (right-associative), or unary minus anywhere.
- Report syntax errors with positions.
- Build an AST and simplify/differentiate it.
- Iterative version without recursion for very deep nesting (explicit stack).
