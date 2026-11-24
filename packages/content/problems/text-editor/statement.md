Implement the buffer behind a simple text editor. The editor holds a string of text and a **cursor** that sits between two characters (or at either end). Initially the text is empty and the cursor is at position 0.

If the text has length `L`, the cursor position `p` always satisfies `0 <= p <= L`; "the characters to the left of the cursor" are `text[0 .. p-1]`.

- `TextEditor()` creates an empty editor.
- `addText(text)` inserts `text` at the cursor. The cursor ends up immediately after the inserted text.
- `deleteText(k) -> int` deletes up to `k` characters immediately to the **left** of the cursor (like pressing Backspace `k` times) and returns how many characters were actually deleted, which is `min(k, p)`.
- `cursorLeft(k) -> string` moves the cursor left by `min(k, p)` positions. It then returns the last `min(10, p')` characters to the left of the new cursor position `p'`, in text order (an empty string if `p' = 0`).
- `cursorRight(k) -> string` moves the cursor right by `min(k, L - p)` positions, then returns the last `min(10, p')` characters to the left of the new position `p'`, exactly like `cursorLeft`.

**Example**

```
TextEditor e
e.addText("interview")      text "interview|"           (| marks the cursor)
e.deleteText(4)    -> 4     text "inter|"
e.addText("nal")            text "internal|"
e.cursorLeft(3)    -> "inter"         text "inter|nal"
e.addText("x")              text "interx|nal"
e.cursorRight(100) -> "interxnal"     cursor moves to the end
e.cursorLeft(20)   -> ""              cursor at 0
e.deleteText(5)    -> 0
e.addText("ab")             text "ab|interxnal"
e.cursorRight(9)   -> "binterxnal"    the 10 characters left of the cursor
```

**Constraints**

- `text` consists of 1 to 40 lowercase English letters.
- `1 <= k <= 40`
- At most `2 * 10^4` calls in total per test.
- Each call should cost time proportional to `k` (or to the length of `text`), not to the length of the whole document.
