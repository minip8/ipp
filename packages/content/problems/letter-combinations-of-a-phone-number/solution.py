KEYS = {"2": "abc", "3": "def", "4": "ghi", "5": "jkl",
        "6": "mno", "7": "pqrs", "8": "tuv", "9": "wxyz"}


class Solution:
    def letterCombinations(self, digits: str) -> list[str]:
        if not digits:
            return []
        res: list[str] = []
        buf = [""] * len(digits)

        def go(i: int) -> None:
            if i == len(digits):
                res.append("".join(buf))
                return
            for ch in KEYS[digits[i]]:
                buf[i] = ch
                go(i + 1)

        go(0)
        return res


if __name__ == "__main__":
    print(Solution().letterCombinations("29"))
