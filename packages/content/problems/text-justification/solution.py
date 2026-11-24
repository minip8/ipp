class Solution:
    def fullJustify(self, words: list[str], maxWidth: int) -> list[str]:
        lines: list[str] = []
        i, n = 0, len(words)
        while i < n:
            j, width = i + 1, len(words[i])  # words[i:j] go on this line; width counts single spaces
            while j < n and width + 1 + len(words[j]) <= maxWidth:
                width += 1 + len(words[j])
                j += 1
            line_words = words[i:j]
            if j == n or len(line_words) == 1:
                line = " ".join(line_words)
                lines.append(line + " " * (maxWidth - len(line)))
            else:
                gaps = len(line_words) - 1
                spaces = maxWidth - sum(len(w) for w in line_words)
                base, extra = divmod(spaces, gaps)
                parts = []
                for k, w in enumerate(line_words[:-1]):
                    parts.append(w + " " * (base + (1 if k < extra else 0)))
                parts.append(line_words[-1])
                lines.append("".join(parts))
            i = j
        return lines


if __name__ == "__main__":
    for line in Solution().fullJustify(["We", "fix", "bugs", "fast", "and", "ship", "often."], 14):
        print(repr(line))
