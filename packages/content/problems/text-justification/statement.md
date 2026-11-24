Format a list of words into lines of **exactly** `maxWidth` characters and return the lines in order.

1. **Packing.** Fill lines greedily: put as many words on the current line as will fit, where consecutive words on a line need at least one space between them. Then start the next line. Words are never split or reordered.
2. **Spacing (every line except the last).** Spread the line's spaces over the gaps between its words as evenly as possible. When they don't divide evenly, gaps further **left** get one more space than gaps further right. A line holding a **single word** is left-justified: the word followed by spaces up to `maxWidth`.
3. **Last line.** Left-justify it: words separated by exactly one space, then padded with spaces on the right up to `maxWidth`.

**Examples** (`.` stands for a space so you can count them; the real output uses `' '`)

```
words = ["We", "fix", "bugs", "fast", "and", "ship", "often."], maxWidth = 14
->  ["We...fix..bugs",       9 letters + 5 spaces; 2 gaps get 3 and 2
     "fast..and.ship",       11 letters + 3 spaces; 2 gaps get 2 and 1
     "often........."]       last line: left-justified and padded

words = ["Practice", "makes", "permanent."], maxWidth = 10
->  ["Practice..",           single word on a line: left-justified
     "makes.....",
     "permanent."]

words = ["a", "b", "c"], maxWidth = 5
->  ["a.b.c"]                the only line is also the last line
```

**Constraints**

- `1 <= words.length <= 2000`
- `1 <= words[i].length <= maxWidth <= 100`
- Words consist of non-space printable ASCII characters (letters, digits, punctuation).
