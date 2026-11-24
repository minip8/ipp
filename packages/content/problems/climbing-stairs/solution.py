class Solution:
    def climbStairs(self, n: int) -> int:
        a, b = 1, 1  # ways to reach step i-1 and step i, starting at i = 1
        for _ in range(n - 1):
            a, b = b, a + b
        return b


if __name__ == "__main__":
    s = Solution()
    print(s.climbStairs(2), s.climbStairs(4), s.climbStairs(45))  # 2 5 1836311903
