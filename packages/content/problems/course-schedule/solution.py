from collections import deque


class Solution:
    def canFinish(self, numCourses: int, prerequisites: list[list[int]]) -> bool:
        out: list[list[int]] = [[] for _ in range(numCourses)]
        indeg = [0] * numCourses
        for a, b in prerequisites:
            out[b].append(a)
            indeg[a] += 1
        queue = deque(i for i in range(numCourses) if indeg[i] == 0)
        taken = 0
        while queue:
            u = queue.popleft()
            taken += 1
            for v in out[u]:
                indeg[v] -= 1
                if indeg[v] == 0:
                    queue.append(v)
        return taken == numCourses


if __name__ == "__main__":
    print(Solution().canFinish(3, [[1, 0], [2, 1]]))  # True
    print(Solution().canFinish(2, [[1, 0], [0, 1]]))  # False
