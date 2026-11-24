class Solution:
    def decodeString(self, s: str) -> str:
        stack: list[tuple[list[str], int]] = []
        cur: list[str] = []
        k = 0
        for ch in s:
            if ch.isdigit():
                k = k * 10 + int(ch)
            elif ch == "[":
                stack.append((cur, k))
                cur, k = [], 0
            elif ch == "]":
                outer, times = stack.pop()
                outer.append("".join(cur) * times)
                cur = outer
            else:
                cur.append(ch)
        return "".join(cur)


if __name__ == "__main__":
    print(Solution().decodeString("x3[y2[z]]"))  # xyzzyzzyzz
