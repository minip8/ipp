import java.util.*;

class MinStack {
    private int[] vals = new int[16], mins = new int[16];
    private int size = 0;

    public MinStack() {}

    public void push(int val) {
        if (size == vals.length) {
            vals = Arrays.copyOf(vals, size * 2);
            mins = Arrays.copyOf(mins, size * 2);
        }
        mins[size] = size == 0 ? val : Math.min(val, mins[size - 1]);
        vals[size++] = val;
    }

    public void pop() { size--; }

    public int top() { return vals[size - 1]; }

    public int getMin() { return mins[size - 1]; }
}

public class Main {
    public static void main(String[] args) {
        MinStack s = new MinStack();
        s.push(4);
        s.push(2);
        s.push(7);
        System.out.println(s.getMin());
        s.pop();
        s.pop();
        System.out.println(s.getMin() + " " + s.top());
    }
}
