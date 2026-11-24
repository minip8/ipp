**Approaches**
- Expected: a stack of open brackets. Push openers; on a closer, the stack must be non-empty and its top must be the matching opener; pop. At the end the stack must be empty. O(n) time, O(n) space.
- Repeatedly deleting `()`, `[]`, `{}` substrings until nothing changes works but is O(n^2) — a good thing for the candidate to reject with a reason.
- Counters per bracket type are **wrong** (they accept `([)]`); if a candidate proposes them, ask for a counter-example.

**Common wrong turns**
- Forgetting the final "stack is empty" check (`"(("` returns true).
- Popping/peeking an empty stack on a leading closer (crash in C++, IndexError in Python).
- One counter per type (accepts crossing pairs).
- Early exit on odd length is a nice optimisation, not a substitute for the checks.

**Hint ladder**
1. When you see a closing bracket, which opening bracket must it match?
2. What data structure gives you "the most recently opened, not yet closed" bracket?
3. Push openers, compare-and-pop on closers, and think about what must be true at the very end.

**Follow-ups**
- Only one bracket type: can you do it in O(1) space? (a depth counter that must never go negative)
- Return the length of the longest valid substring (stack of indices or two-pass counters).
- Minimum number of insertions to make it valid.
- Strings that also contain other characters, or brackets inside quoted strings (tokeniser).
