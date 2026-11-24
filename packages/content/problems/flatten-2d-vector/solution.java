class Vector2D {
    private final int[][] vec;
    private int row = 0, col = 0;

    public Vector2D(int[][] vec) { this.vec = vec; }

    private void settle() {
        while (row < vec.length && col == vec[row].length) {
            row++;
            col = 0;
        }
    }

    public int next() {
        settle();
        return vec[row][col++];
    }

    public boolean hasNext() {
        settle();
        return row < vec.length;
    }
}

public class Main {
    public static void main(String[] args) {
        Vector2D it = new Vector2D(new int[][] {{1, 2}, {}, {3}, {}, {}});
        StringBuilder sb = new StringBuilder();
        while (it.hasNext()) sb.append(it.next()).append(' ');
        System.out.println(sb);
    }
}
