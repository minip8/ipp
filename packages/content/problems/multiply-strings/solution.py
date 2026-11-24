class Solution:
    def multiply(self, num1: str, num2: str) -> str:
        if num1 == "0" or num2 == "0":
            return "0"
        n, m = len(num1), len(num2)
        res = [0] * (n + m)
        for i in range(n - 1, -1, -1):
            a = ord(num1[i]) - 48
            for j in range(m - 1, -1, -1):
                res[i + j + 1] += a * (ord(num2[j]) - 48)
        for k in range(n + m - 1, 0, -1):
            res[k - 1] += res[k] // 10
            res[k] %= 10
        start = 0
        while res[start] == 0:
            start += 1
        return "".join(map(str, res[start:]))


if __name__ == "__main__":
    print(Solution().multiply("999", "999"))  # 998001
