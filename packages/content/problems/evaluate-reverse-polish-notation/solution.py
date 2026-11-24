class Solution:
    def evalRPN(self, tokens: list[str]) -> int:
        stack: list[int] = []
        for tok in tokens:
            if tok in ("+", "-", "*", "/"):
                b = stack.pop()
                a = stack.pop()
                if tok == "+":
                    stack.append(a + b)
                elif tok == "-":
                    stack.append(a - b)
                elif tok == "*":
                    stack.append(a * b)
                else:
                    q = abs(a) // abs(b)
                    stack.append(q if (a < 0) == (b < 0) else -q)
            else:
                stack.append(int(tok))
        return stack[-1]


if __name__ == "__main__":
    print(Solution().evalRPN(["3", "4", "+", "2", "*"]))  # 14
