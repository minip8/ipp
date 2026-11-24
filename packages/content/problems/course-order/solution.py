import heapq


class Solution:
    def findOrder(self, numCourses: int, prerequisites: list[list[int]]) -> list[int]:
        out: list[list[int]] = [[] for _ in range(numCourses)]
        indeg = [0] * numCourses
        for a, b in prerequisites:
            out[b].append(a)
            indeg[a] += 1
        ready = [i for i in range(numCourses) if indeg[i] == 0]  # already sorted: a valid heap
        order = []
        while ready:
            u = heapq.heappop(ready)
            order.append(u)
            for v in out[u]:
                indeg[v] -= 1
                if indeg[v] == 0:
                    heapq.heappush(ready, v)
        return order if len(order) == numCourses else []


if __name__ == "__main__":
    print(Solution().findOrder(4, [[1, 0], [2, 0], [3, 1], [3, 2]]))  # [0, 1, 2, 3]
    print(Solution().findOrder(4, [[0, 3], [1, 3]]))  # [2, 3, 0, 1]
