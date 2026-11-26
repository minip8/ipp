#include <cstddef>
#include <iostream>
#include <iterator>
#include <type_traits>
#include <utility>

template <class T>
class List {
    // The sentinel has links but no T (T may have no default constructor), so the links live in a
    // base struct and the value in a derived node.
    struct NodeBase {
        NodeBase* prev;
        NodeBase* next;
    };
    struct Node : NodeBase {
        T value;
    };

public:
    // TODO: an iterator and a const_iterator (see the statement for the members they need; one
    // class template with a `bool Const` parameter can provide both).
    class iterator {};
    class const_iterator {};

    List() noexcept = default;

    // TODO: destructor, copy constructor, copy assignment, move constructor, move assignment
    // (the rule of five; see the statement for what each must do and which must be noexcept).

    iterator begin() noexcept { return iterator(); }
    iterator end() noexcept { return iterator(); }
    const_iterator begin() const noexcept { return const_iterator(); }
    const_iterator end() const noexcept { return const_iterator(); }

    bool empty() const noexcept { return size_ == 0; }
    std::size_t size() const noexcept { return size_; }

    // TODO: front, back, push_front, push_back, insert, emplace, pop_front, pop_back, erase,
    // clear, both splice overloads, reverse.

private:
    NodeBase sentinel_{&sentinel_, &sentinel_};  // prev = last element, next = first element
    std::size_t size_ = 0;
};

int main() {
    // "Run" executes this file exactly as written - call your code here to try it out.
    // "Run tests" and "Submit" ignore main() and test List<T> through a hidden harness
    // (see the statement for what each test operation does).
    return 0;
}
