#include <cstddef>
#include <iostream>
#include <iterator>
#include <type_traits>
#include <utility>

template <class T>
class List {
    // The links live in a base without a T, so the sentinel (a member of the List) needs no T:
    // T may have no default constructor, and an empty List allocates nothing.
    struct NodeBase {
        NodeBase* prev;
        NodeBase* next;
    };
    struct Node : NodeBase {
        T value;

        template <class... Args>
        explicit Node(Args&&... args) : NodeBase{nullptr, nullptr}, value(std::forward<Args>(args)...) {}
    };

    template <bool Const>
    class Iter {
        using BasePtr = std::conditional_t<Const, const NodeBase*, NodeBase*>;
        using NodePtr = std::conditional_t<Const, const Node*, Node*>;

    public:
        using iterator_category = std::bidirectional_iterator_tag;
        using value_type = T;
        using difference_type = std::ptrdiff_t;
        using pointer = std::conditional_t<Const, const T*, T*>;
        using reference = std::conditional_t<Const, const T&, T&>;

        Iter() = default;

        // iterator -> const_iterator (and not the other way round). Declared with Iter<!Const>
        // so that in iterator it is not a copy constructor (which would suppress the implicit one).
        Iter(const Iter<!Const>& other) noexcept
            requires Const
            : node_(other.node_) {}

        reference operator*() const { return static_cast<NodePtr>(node_)->value; }
        pointer operator->() const { return &static_cast<NodePtr>(node_)->value; }

        Iter& operator++() {
            node_ = node_->next;
            return *this;
        }
        Iter operator++(int) {
            Iter old = *this;
            node_ = node_->next;
            return old;
        }
        Iter& operator--() {
            node_ = node_->prev;
            return *this;
        }
        Iter operator--(int) {
            Iter old = *this;
            node_ = node_->prev;
            return old;
        }

        friend bool operator==(const Iter& a, const Iter& b) { return a.node_ == b.node_; }

    private:
        friend class List;
        friend class Iter<!Const>;
        explicit Iter(BasePtr n) noexcept : node_(n) {}

        BasePtr node_ = nullptr;
    };

public:
    using value_type = T;
    using iterator = Iter<false>;
    using const_iterator = Iter<true>;

    List() noexcept = default;

    List(const List& other) : List() {
        // Delegating: if a copy throws, the destructor of the already-constructed List cleans up.
        for (const T& v : other) push_back(v);
    }

    List(List&& other) noexcept : List() { splice(end(), other); }

    List& operator=(const List& other) {
        if (this != &other) {
            List copy(other);  // strong guarantee: nothing changes if a copy throws
            clear();
            splice(end(), copy);
        }
        return *this;
    }

    List& operator=(List&& other) noexcept {
        if (this != &other) {
            clear();
            splice(end(), other);
        }
        return *this;
    }

    ~List() { clear(); }

    // ---- iterators
    iterator begin() noexcept { return iterator(sentinel_.next); }
    iterator end() noexcept { return iterator(&sentinel_); }
    const_iterator begin() const noexcept { return const_iterator(sentinel_.next); }
    const_iterator end() const noexcept { return const_iterator(&sentinel_); }

    // ---- size and access
    bool empty() const noexcept { return size_ == 0; }
    std::size_t size() const noexcept { return size_; }

    T& front() { return *begin(); }
    const T& front() const { return *begin(); }
    T& back() { return *--end(); }
    const T& back() const { return *--end(); }

    // ---- insertion: one heap node per element, built in place
    template <class... Args>
    iterator emplace(const_iterator pos, Args&&... args) {
        Node* n = new Node(std::forward<Args>(args)...);
        linkBefore(mutableNode(pos), n);
        ++size_;
        return iterator(n);
    }
    iterator insert(const_iterator pos, const T& value) { return emplace(pos, value); }
    iterator insert(const_iterator pos, T&& value) { return emplace(pos, std::move(value)); }

    void push_front(const T& value) { emplace(begin(), value); }
    void push_front(T&& value) { emplace(begin(), std::move(value)); }
    void push_back(const T& value) { emplace(end(), value); }
    void push_back(T&& value) { emplace(end(), std::move(value)); }

    // ---- removal
    iterator erase(const_iterator pos) {
        NodeBase* n = mutableNode(pos);
        NodeBase* next = n->next;
        unlink(n);
        --size_;
        delete static_cast<Node*>(n);
        return iterator(next);
    }
    void pop_front() { erase(begin()); }
    void pop_back() { erase(--end()); }

    void clear() noexcept {
        NodeBase* n = sentinel_.next;
        while (n != &sentinel_) {
            NodeBase* next = n->next;
            delete static_cast<Node*>(n);
            n = next;
        }
        sentinel_.prev = sentinel_.next = &sentinel_;
        size_ = 0;
    }

    // ---- relinking: no element is copied, moved or destroyed, no node allocated or freed
    // Moves every element of other (another list) before pos.
    void splice(const_iterator pos, List& other) noexcept {
        if (&other == this || other.empty()) return;
        NodeBase* p = mutableNode(pos);
        NodeBase* first = other.sentinel_.next;
        NodeBase* last = other.sentinel_.prev;
        other.sentinel_.prev = other.sentinel_.next = &other.sentinel_;
        first->prev = p->prev;
        last->next = p;
        p->prev->next = first;
        p->prev = last;
        size_ += other.size_;
        other.size_ = 0;
    }

    // Moves the element at it (in other, which may be this list) before pos.
    void splice(const_iterator pos, List& other, const_iterator it) noexcept {
        NodeBase* p = mutableNode(pos);
        NodeBase* n = mutableNode(it);
        if (p == n || p == n->next) return;  // already in place
        unlink(n);
        linkBefore(p, n);
        if (&other != this) {
            --other.size_;
            ++size_;
        }
    }

    // Swaps prev and next in every node, the sentinel included.
    void reverse() noexcept {
        NodeBase* n = &sentinel_;
        do {
            std::swap(n->prev, n->next);
            n = n->prev;  // the old next
        } while (n != &sentinel_);
    }

private:
    // A const_iterator names a node of this (non-const) list, so it may be modified.
    static NodeBase* mutableNode(const_iterator it) noexcept { return const_cast<NodeBase*>(it.node_); }

    static void unlink(NodeBase* n) noexcept {
        n->prev->next = n->next;
        n->next->prev = n->prev;
    }
    static void linkBefore(NodeBase* pos, NodeBase* n) noexcept {
        n->prev = pos->prev;
        n->next = pos;
        pos->prev->next = n;
        pos->prev = n;
    }

    NodeBase sentinel_{&sentinel_, &sentinel_};  // prev = last element, next = first element
    std::size_t size_ = 0;
};

int main() {
    List<int> a;
    for (int i = 1; i <= 5; ++i) a.push_back(i);
    auto three = std::next(a.begin(), 2);
    a.erase(std::next(three));  // removes 4; `three` stays valid
    a.insert(three, 30);        // 1 2 30 3 5

    List<int> b;
    b.push_back(100);
    b.splice(b.end(), a, three);  // relink 3 into b
    a.reverse();
    for (int x : a) std::cout << x << ' ';  // 5 30 2 1
    std::cout << "| ";
    for (int x : b) std::cout << x << ' ';  // 100 3
    std::cout << "| " << *three << ' ' << a.size() << ' ' << b.size() << '\n';  // 3 4 2
    return 0;
}
