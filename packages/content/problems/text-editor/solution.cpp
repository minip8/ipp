#include <bits/stdc++.h>
using namespace std;

// Two stacks around the cursor (a gap buffer split in two):
// `left` is the text before the cursor; `right` is the text after it, reversed.
class TextEditor {
    string left, right;

    string tail() const { return left.substr(left.size() - min<size_t>(10, left.size())); }

public:
    TextEditor() {}

    void addText(string text) { left += text; }

    int deleteText(int k) {
        int d = min<int>(k, left.size());
        left.resize(left.size() - d);
        return d;
    }

    string cursorLeft(int k) {
        for (int i = min<int>(k, left.size()); i > 0; --i) {
            right.push_back(left.back());
            left.pop_back();
        }
        return tail();
    }

    string cursorRight(int k) {
        for (int i = min<int>(k, right.size()); i > 0; --i) {
            left.push_back(right.back());
            right.pop_back();
        }
        return tail();
    }
};

int main() {
    TextEditor e;
    e.addText("interview");
    cout << e.deleteText(4) << '\n';  // 4
    e.addText("nal");
    cout << e.cursorLeft(3) << '\n';  // inter
    e.addText("x");
    cout << e.cursorRight(100) << '\n';  // interxnal
    cout << '[' << e.cursorLeft(20) << "]\n";  // []
    return 0;
}
