class Solution:
    def isValid(self, s: str) -> bool:
        match = {")": "(", "]": "[", "}": "{"}
        stack = []
        for c in s:
            if c in match:
                if not stack or stack[-1] != match[c]:
                    return False
                stack.pop()
            else:
                stack.append(c)
        return not stack


if __name__ == "__main__":
    print(Solution().isValid("{[]()}"), Solution().isValid("([)]"))  # True False
