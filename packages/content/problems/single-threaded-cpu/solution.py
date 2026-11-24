import heapq


class Solution:
    def getOrder(self, tasks: list[list[int]]) -> list[int]:
        order = sorted(range(len(tasks)), key=lambda i: tasks[i][0])
        heap: list[tuple[int, int]] = []  # (processingTime, index)
        out = []
        clock, j, n = 0, 0, len(tasks)
        while len(out) < n:
            if not heap and clock < tasks[order[j]][0]:
                clock = tasks[order[j]][0]  # idle: jump to the next arrival
            while j < n and tasks[order[j]][0] <= clock:
                i = order[j]
                heapq.heappush(heap, (tasks[i][1], i))
                j += 1
            proc, i = heapq.heappop(heap)
            out.append(i)
            clock += proc
        return out


if __name__ == "__main__":
    print(Solution().getOrder([[1, 3], [2, 1], [3, 2], [4, 1]]))  # [0, 1, 3, 2]
