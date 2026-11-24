Implement a matcher for a tiny regular-expression language and decide whether the pattern `p` matches the **entire** string `s` (not just a part of it).

The pattern contains lowercase letters and two special characters:

- `.` matches any single character.
- `*` means "zero or more copies of the element right before it". The element is the single character (a letter or `.`) immediately to the left of the `*`.

Every `*` in a pattern is preceded by a letter or `.`, never by another `*` or by nothing.

**Examples**

```
s = "aab",       p = "c*a*b"     ->  true     (zero c's, two a's, one b)
s = "mississippi", p = "mis*is*p*."  ->  false
s = "abcd",      p = ".*d"       ->  true     (".*" takes "abc")
s = "ab",        p = ".*c"       ->  false
s = "aaa",       p = "a"         ->  false    (the match must cover all of s)
```

**Constraints**

- `1 <= s.length <= 200`
- `1 <= p.length <= 200`
- `s` contains only lowercase letters; `p` contains only lowercase letters, `.` and `*`, and every `*` follows a letter or `.`.
