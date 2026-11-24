#include <bits/stdc++.h>
using namespace std;

// Circular list around a sentinel node: sent.next is the front, sent.prev the back.
// std::vector appears only as the return type of toArray / toArrayReversed.
class DoublyLinkedList {
    struct Node {
        int val;
        Node* prev;
        Node* next;
    };
    Node sent{0, &sent, &sent};
    int n = 0;

    void linkBefore(Node* at, int value) {
        Node* node = new Node{value, at->prev, at};
        at->prev->next = node;
        at->prev = node;
        ++n;
    }

    int unlink(Node* node) {
        node->prev->next = node->next;
        node->next->prev = node->prev;
        int v = node->val;
        delete node;
        --n;
        return v;
    }

    // Node at position index (0 <= index <= n; n is the sentinel), walking from the nearer end.
    Node* nodeAt(int index) {
        Node* p;
        if (index <= n / 2) {
            p = sent.next;
            for (int i = 0; i < index; ++i) p = p->next;
        } else {
            p = &sent;
            for (int i = n; i > index; --i) p = p->prev;
        }
        return p;
    }

public:
    DoublyLinkedList() = default;
    ~DoublyLinkedList() {
        while (n) unlink(sent.next);
    }
    DoublyLinkedList(const DoublyLinkedList&) = delete;
    DoublyLinkedList& operator=(const DoublyLinkedList&) = delete;

    void pushFront(int value) { linkBefore(sent.next, value); }
    void pushBack(int value) { linkBefore(&sent, value); }
    int popFront() { return n ? unlink(sent.next) : -1; }
    int popBack() { return n ? unlink(sent.prev) : -1; }
    int front() { return n ? sent.next->val : -1; }
    int back() { return n ? sent.prev->val : -1; }

    int get(int index) { return index >= 0 && index < n ? nodeAt(index)->val : -1; }

    bool insert(int index, int value) {
        if (index < 0 || index > n) return false;
        linkBefore(nodeAt(index), value);
        return true;
    }

    int erase(int index) { return index >= 0 && index < n ? unlink(nodeAt(index)) : -1; }

    int size() { return n; }

    void reverse() {
        Node* p = &sent;
        do {
            swap(p->prev, p->next);
            p = p->prev;  // the old next
        } while (p != &sent);
    }

    vector<int> toArray() {
        vector<int> out;
        for (Node* p = sent.next; p != &sent; p = p->next) out.push_back(p->val);
        return out;
    }

    vector<int> toArrayReversed() {
        vector<int> out;
        for (Node* p = sent.prev; p != &sent; p = p->prev) out.push_back(p->val);
        return out;
    }
};

int main() {
    DoublyLinkedList l;
    for (int v : {1, 2, 3}) l.pushBack(v);
    l.pushFront(0);
    l.insert(2, 9);
    cout << l.erase(0) << ' ' << l.popBack() << '\n';  // 0 3
    l.reverse();
    for (int v : l.toArray()) cout << v << ' ';  // 2 9 1
    cout << '\n';
    return 0;
}
