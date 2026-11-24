Implement a function that reads a 32-bit signed integer from the start of a string, following exactly these rules:

1. **Whitespace:** skip any leading space characters `' '` (only the space character counts as whitespace).
2. **Sign:** if the next character is `'-'` or `'+'`, read it; it determines the sign. At most one sign character is allowed. If there is none, the number is positive.
3. **Digits:** read consecutive digits `0-9` and stop at the first non-digit character or the end of the string. Leading zeros are allowed. Everything after the digits is ignored.
4. **No digits:** if no digits were read in step 3, the result is `0`.
5. **Clamp:** if the value is outside the 32-bit signed range `[-2^31, 2^31 - 1]`, clamp it to the nearest bound (`-2147483648` or `2147483647`).

Do not use library parsing functions that do this for you (`atoi`, `stoi`, `int()` on the whole string, ...).

**Examples**

```
s = "   -0042xyz"            ->   -42
s = "+17 apples"              ->   17
s = "words 99"                ->   0             stops at 'w' before any digit
s = "-91283472332"            ->   -2147483648   clamped
s = "+-5"                     ->   0             a second sign character is not a digit
s = "  +  3"                  ->   0             spaces are not allowed after the sign
```

**Constraints**

- `0 <= s.length <= 200`
- `s` consists of English letters, digits, `' '`, `'+'`, `'-'` and `'.'`.
