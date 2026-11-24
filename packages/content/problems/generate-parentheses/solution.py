class Solution:
    def generateParenthesis(self, n: int) -> list[str]:
        res: list[str] = []
        buf: list[str] = []

        def go(opened: int, closed: int) -> None:
            if closed == n:
                res.append("".join(buf))
                return
            if opened < n:
                buf.append("(")
                go(opened + 1, closed)
                buf.pop()
            if closed < opened:
                buf.append(")")
                go(opened, closed + 1)
                buf.pop()

        go(0, 0)
        return res


if __name__ == "__main__":
    print(Solution().generateParenthesis(3))
