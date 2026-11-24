class Solution:
    def fractionToDecimal(self, numerator: int, denominator: int) -> str:
        if numerator == 0:
            return "0"
        sign = "-" if (numerator < 0) != (denominator < 0) else ""
        num, den = abs(numerator), abs(denominator)
        whole, rem = divmod(num, den)
        if rem == 0:
            return sign + str(whole)
        digits: list[str] = []
        seen: dict[int, int] = {}
        while rem and rem not in seen:
            seen[rem] = len(digits)
            d, rem = divmod(rem * 10, den)
            digits.append(str(d))
        if rem:
            i = seen[rem]
            frac = "".join(digits[:i]) + "(" + "".join(digits[i:]) + ")"
        else:
            frac = "".join(digits)
        return f"{sign}{whole}.{frac}"


if __name__ == "__main__":
    print(Solution().fractionToDecimal(-22, 7))  # -3.(142857)
