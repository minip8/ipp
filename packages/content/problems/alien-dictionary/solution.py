import heapq


class Solution:
    def alienOrder(self, words: list[str]) -> str:
        letters = sorted({ch for w in words for ch in w})
        after: dict[str, set[str]] = {ch: set() for ch in letters}
        indeg = {ch: 0 for ch in letters}
        for a, b in zip(words, words[1:]):
            for x, y in zip(a, b):
                if x != y:
                    if y not in after[x]:
                        after[x].add(y)
                        indeg[y] += 1
                    break
            else:
                if len(a) > len(b):
                    return ""
        ready = [ch for ch in letters if indeg[ch] == 0]  # sorted, so already a heap
        out = []
        while ready:
            ch = heapq.heappop(ready)
            out.append(ch)
            for nxt in after[ch]:
                indeg[nxt] -= 1
                if indeg[nxt] == 0:
                    heapq.heappush(ready, nxt)
        return "".join(out) if len(out) == len(letters) else ""


if __name__ == "__main__":
    print(Solution().alienOrder(["wrt", "wrf", "er", "ett", "rftt"]))  # wertf
    print(Solution().alienOrder(["zx", "zy", "q"]))  # xyzq
