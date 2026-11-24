import java.util.*;

class TextEditor {
    private final StringBuilder left = new StringBuilder();
    private final StringBuilder right = new StringBuilder(); // reversed

    public TextEditor() {}

    public void addText(String text) {
        left.append(text);
    }

    public int deleteText(int k) {
        int d = Math.min(k, left.length());
        left.setLength(left.length() - d);
        return d;
    }

    private String tail() {
        return left.substring(Math.max(0, left.length() - 10));
    }

    public String cursorLeft(int k) {
        for (int i = Math.min(k, left.length()); i > 0; i--) {
            right.append(left.charAt(left.length() - 1));
            left.setLength(left.length() - 1);
        }
        return tail();
    }

    public String cursorRight(int k) {
        for (int i = Math.min(k, right.length()); i > 0; i--) {
            left.append(right.charAt(right.length() - 1));
            right.setLength(right.length() - 1);
        }
        return tail();
    }
}

public class Main {
    public static void main(String[] args) {
        TextEditor e = new TextEditor();
        e.addText("interview");
        System.out.println(e.deleteText(4));
        e.addText("nal");
        System.out.println(e.cursorLeft(3));
        e.addText("x");
        System.out.println(e.cursorRight(100));
    }
}
