A string contains only the bracket characters `(`, `)`, `[`, `]`, `{` and `}`. Return `true` if the brackets are **properly balanced**:

- every opening bracket is closed by a closing bracket of the same type,
- brackets close in the reverse order they were opened (so pairs nest and never cross), and
- every closing bracket has a matching opening bracket before it.

**Examples**

```
s = "{[]()}"     ->   true
s = "([)]"       ->   false    the pairs cross
s = "(("         ->   false    never closed
s = "])"         ->   false    closes something that was never opened
```

**Constraints**

- `1 <= s.length <= 10^5`
- `s` contains only the six characters `()[]{}`.
