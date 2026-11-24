class Solution:
    def removeKdigits(self, num: str, k: int) -> str:
        stack: list[str] = []
        for d in num:
            while k and stack and stack[-1] > d:
                stack.pop()
                k -= 1
            stack.append(d)
        if k:
            del stack[-k:]
        return "".join(stack).lstrip("0") or "0"


if __name__ == "__main__":
    print(Solution().removeKdigits("4352", 1))  # 352
