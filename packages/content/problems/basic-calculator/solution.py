class Solution:
    def calculate(self, s: str) -> int:
        tokens: list[str] = []
        i = 0
        while i < len(s):
            c = s[i]
            if c.isdigit():
                j = i
                while j < len(s) and s[j].isdigit():
                    j += 1
                tokens.append(s[i:j])
                i = j
            else:
                if c != " ":
                    tokens.append(c)
                i += 1
        pos = 0

        def div(a: int, b: int) -> int:
            q = abs(a) // abs(b)
            return q if (a < 0) == (b < 0) else -q

        def expr() -> int:
            nonlocal pos
            negate = pos < len(tokens) and tokens[pos] == "-"
            if negate:
                pos += 1
            value = term()
            if negate:
                value = -value
            while pos < len(tokens) and tokens[pos] in "+-":
                op = tokens[pos]
                pos += 1
                rhs = term()
                value = value + rhs if op == "+" else value - rhs
            return value

        def term() -> int:
            nonlocal pos
            value = factor()
            while pos < len(tokens) and tokens[pos] in "*/":
                op = tokens[pos]
                pos += 1
                rhs = factor()
                value = value * rhs if op == "*" else div(value, rhs)
            return value

        def factor() -> int:
            nonlocal pos
            tok = tokens[pos]
            pos += 1
            if tok == "(":
                value = expr()
                pos += 1  # skip ')'
                return value
            return int(tok)

        return expr()


if __name__ == "__main__":
    print(Solution().calculate("2*(3+(4-10)/4)"))  # 4
