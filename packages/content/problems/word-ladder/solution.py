from string import ascii_lowercase


class Solution:
    def ladderLength(self, beginWord: str, endWord: str, wordList: list[str]) -> int:
        unvisited = set(wordList)
        if endWord not in unvisited:
            return 0
        unvisited.discard(beginWord)
        frontier, steps = [beginWord], 1
        while frontier:
            steps += 1
            nxt = []
            for word in frontier:
                chars = list(word)
                for i, original in enumerate(chars):
                    for ch in ascii_lowercase:
                        if ch == original:
                            continue
                        chars[i] = ch
                        cand = "".join(chars)
                        if cand in unvisited:
                            if cand == endWord:
                                return steps
                            unvisited.remove(cand)
                            nxt.append(cand)
                    chars[i] = original
            frontier = nxt
        return 0


if __name__ == "__main__":
    words = ["cord", "card", "ward", "warm", "word", "worm", "wore"]
    print(Solution().ladderLength("cold", "warm", words))  # 5
