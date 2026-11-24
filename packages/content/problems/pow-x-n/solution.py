class Solution:
    def myPow(self, x: float, n: int) -> float:
        if n < 0:
            x, n = 1.0 / x, -n
        result = 1.0
        while n:
            if n & 1:
                result *= x
            x *= x
            n >>= 1
        return result


if __name__ == "__main__":
    print(Solution().myPow(2.0, -2))  # 0.25
