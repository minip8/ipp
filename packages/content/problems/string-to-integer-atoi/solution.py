INT_MAX, INT_MIN = 2**31 - 1, -(2**31)


class Solution:
    def myAtoi(self, s: str) -> int:
        i, n = 0, len(s)
        while i < n and s[i] == " ":
            i += 1
        sign = 1
        if i < n and s[i] in "+-":
            sign = -1 if s[i] == "-" else 1
            i += 1
        limit = INT_MAX if sign > 0 else -INT_MIN
        result = 0
        while i < n and s[i].isdigit():
            result = result * 10 + (ord(s[i]) - 48)
            if result >= limit:
                return sign * limit
            i += 1
        return sign * result


if __name__ == "__main__":
    print(Solution().myAtoi("   -0042xyz"))  # -42
