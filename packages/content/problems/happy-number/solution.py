def step(n: int) -> int:
    total = 0
    while n:
        n, d = divmod(n, 10)
        total += d * d
    return total


class Solution:
    def isHappy(self, n: int) -> bool:
        slow, fast = n, step(n)
        while fast != 1 and slow != fast:
            slow = step(slow)
            fast = step(step(fast))
        return fast == 1


if __name__ == "__main__":
    print(Solution().isHappy(7), Solution().isHappy(4))  # True False
