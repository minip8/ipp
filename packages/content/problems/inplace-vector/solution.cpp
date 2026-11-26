#include <algorithm>
#include <cstddef>
#include <iostream>
#include <memory>
#include <new>
#include <type_traits>
#include <utility>

template <class T, std::size_t N>
class InplaceVector {
public:
    InplaceVector() noexcept {}

    InplaceVector(const InplaceVector& other) {
        for (const T& x : other) unchecked_emplace_back(x);
    }

    // Inline storage cannot be stolen: each element is moved, and other keeps its (moved-from)
    // elements until it is destroyed or cleared.
    InplaceVector(InplaceVector&& other) noexcept(std::is_nothrow_move_constructible_v<T>) {
        for (T& x : other) unchecked_emplace_back(std::move(x));
    }

    InplaceVector& operator=(const InplaceVector& other) {
        if (this != &other) assignFrom(other.begin(), other.size_);
        return *this;
    }

    InplaceVector& operator=(InplaceVector&& other) noexcept(std::is_nothrow_move_constructible_v<T> &&
                                                             std::is_nothrow_move_assignable_v<T>) {
        if (this != &other) assignFrom(std::make_move_iterator(other.begin()), other.size_);
        return *this;
    }

    ~InplaceVector() { clear(); }

    static constexpr std::size_t capacity() noexcept { return N; }
    std::size_t size() const noexcept { return size_; }
    bool empty() const noexcept { return size_ == 0; }

    T& operator[](std::size_t i) { return data_[i]; }
    const T& operator[](std::size_t i) const { return data_[i]; }

    T* begin() noexcept { return data_; }
    T* end() noexcept { return data_ + size_; }
    const T* begin() const noexcept { return data_; }
    const T* end() const noexcept { return data_ + size_; }

    template <class... Args>
    T& emplace_back(Args&&... args) {
        if (size_ == N) throw std::bad_alloc();
        return unchecked_emplace_back(std::forward<Args>(args)...);
    }
    void push_back(const T& value) { emplace_back(value); }
    void push_back(T&& value) { emplace_back(std::move(value)); }

    T* try_push_back(const T& value) {
        return size_ == N ? nullptr : std::addressof(unchecked_emplace_back(value));
    }
    T* try_push_back(T&& value) {
        return size_ == N ? nullptr : std::addressof(unchecked_emplace_back(std::move(value)));
    }

    void pop_back() {
        --size_;
        std::destroy_at(end());
    }

    void clear() noexcept {
        while (size_ > 0) pop_back();
    }

    // Copies value first: it may refer to an element that the shift is about to overwrite.
    T* insert(const T* pos, const T& value) {
        if (size_ == N) throw std::bad_alloc();
        if (pos == end()) return std::addressof(unchecked_emplace_back(value));
        T copy(value);
        return insert(pos, std::move(copy));
    }

    // The slot at end() is raw storage: the old last element is move-constructed into it. Every
    // other slot from pos on holds a live element, so those are move-assigned, from the back.
    T* insert(const T* pos, T&& value) {
        if (size_ == N) throw std::bad_alloc();
        T* p = mutablePos(pos);
        if (p == end()) return std::addressof(unchecked_emplace_back(std::move(value)));
        T* last = end() - 1;
        unchecked_emplace_back(std::move(*last));
        std::move_backward(p, last, last + 1);
        *p = std::move(value);
        return p;
    }

    T* erase(const T* pos) { return erase(pos, pos + 1); }

    T* erase(const T* first, const T* last) {
        T* f = mutablePos(first);
        T* l = mutablePos(last);
        if (f != l) {
            T* newEnd = std::move(l, end(), f);
            while (end() != newEnd) pop_back();
        }
        return f;
    }

private:
    T* mutablePos(const T* p) noexcept { return data_ + (p - data_); }

    template <class... Args>
    T& unchecked_emplace_back(Args&&... args) {
        T* p = std::construct_at(end(), std::forward<Args>(args)...);
        ++size_;
        return *p;
    }

    // Assigns over the elements both vectors have, constructs the rest or destroys the surplus.
    template <class It>
    void assignFrom(It src, std::size_t n) {
        std::size_t common = std::min(size_, n);
        for (std::size_t i = 0; i < common; ++i, ++src) data_[i] = *src;
        for (std::size_t i = common; i < n; ++i, ++src) unchecked_emplace_back(*src);
        while (size_ > n) pop_back();
    }

    // Storage for N elements with T's size and alignment. A union member is never constructed
    // or destroyed implicitly: only data_[0 .. size_) hold live objects, and their lifetimes are
    // managed here with construct_at / destroy_at.
    union {
        T data_[N];
    };
    std::size_t size_ = 0;
};

struct Point {
    int x, y;
    Point(int x, int y) : x(x), y(y) {}  // no default constructor
};

int main() {
    InplaceVector<Point, 4> v;
    v.emplace_back(1, 1);
    v.emplace_back(3, 3);
    v.insert(v.begin() + 1, Point(2, 2));
    v.push_back(v[0]);
    std::cout << "full: " << (v.try_push_back(Point(9, 9)) == nullptr) << '\n';  // 1
    v.erase(v.begin());
    for (const Point& p : v) std::cout << '(' << p.x << ',' << p.y << ") ";  // (2,2) (3,3) (1,1)
    std::cout << '\n';
    try {
        v.emplace_back(5, 5);
        v.emplace_back(6, 6);
    } catch (const std::bad_alloc&) {
        std::cout << "push_back on a full InplaceVector throws std::bad_alloc\n";
    }
    return 0;
}
