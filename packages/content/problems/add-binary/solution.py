class Solution:
    def addBinary(self, a: str, b: str) -> str:
        i, j, carry, out = len(a) - 1, len(b) - 1, 0, []
        while i >= 0 or j >= 0 or carry:
            total = carry
            if i >= 0:
                total += a[i] == "1"
                i -= 1
            if j >= 0:
                total += b[j] == "1"
                j -= 1
            out.append("1" if total & 1 else "0")
            carry = total >> 1
        return "".join(reversed(out))


if __name__ == "__main__":
    print(Solution().addBinary("1011", "110"))  # 10001
