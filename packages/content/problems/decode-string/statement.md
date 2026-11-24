A compressed string uses the pattern `k[body]` to mean "`body` repeated `k` times". Patterns can be nested and can sit next to plain letters. Return the fully expanded string.

The input is always well formed:

- `k` is a positive integer written in decimal with no leading zeros (it can have several digits),
- every `[` is preceded by a number and has a matching `]`,
- digits only ever appear as repeat counts, and
- plain text consists of lowercase letters.

**Examples**

```
s = "2[ab]c"           ->   "ababc"
s = "x3[y2[z]]"        ->   "xyzzyzzyzz"
s = "10[a]"            ->   "aaaaaaaaaa"     counts can have several digits
s = "ab2[]c"           ->   "abc"            the body may be empty
```

**Constraints**

- `1 <= s.length <= 3000`
- `1 <= k <= 300`
- The decoded string has length at most `10^5`.
