class CircularQueue {
    private final int[] buf;
    private int head = 0, count = 0;

    public CircularQueue(int capacity) { buf = new int[capacity]; }

    public boolean enqueue(int value) {
        if (count == buf.length) return false;
        buf[(head + count) % buf.length] = value;
        count++;
        return true;
    }

    public boolean dequeue() {
        if (count == 0) return false;
        head = (head + 1) % buf.length;
        count--;
        return true;
    }

    public int front() { return count == 0 ? -1 : buf[head]; }

    public int rear() { return count == 0 ? -1 : buf[(head + count - 1) % buf.length]; }

    public boolean isEmpty() { return count == 0; }

    public boolean isFull() { return count == buf.length; }
}

public class Main {
    public static void main(String[] args) {
        CircularQueue q = new CircularQueue(3);
        for (int v : new int[] {1, 2, 3, 4}) System.out.print(q.enqueue(v) + " ");
        System.out.println();
        q.dequeue();
        q.enqueue(4);
        System.out.println(q.front() + " " + q.rear());
    }
}
