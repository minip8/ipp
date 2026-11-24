class Solution:
    def gameOfLife(self, board: list[list[int]]) -> list[list[int]]:
        m, n = len(board), len(board[0])
        for i in range(m):
            for j in range(n):
                live = 0
                for di in (-1, 0, 1):
                    for dj in (-1, 0, 1):
                        if (di or dj) and 0 <= i + di < m and 0 <= j + dj < n:
                            live += board[i + di][j + dj] & 1
                alive = board[i][j] & 1
                if live == 3 or (alive and live == 2):
                    board[i][j] |= 2  # bit 1 holds the next generation
        for row in board:
            for j in range(n):
                row[j] >>= 1
        return board


if __name__ == "__main__":
    print(Solution().gameOfLife([[0, 1, 0], [0, 1, 0], [0, 1, 0]]))  # [[0, 0, 0], [1, 1, 1], [0, 0, 0]]
