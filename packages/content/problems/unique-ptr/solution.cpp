#include <cstddef>
#include <iostream>
#include <utility>

template <class T>
class UniquePtr {
public:
    UniquePtr() noexcept = default;
    explicit UniquePtr(T* p) noexcept : ptr_(p) {}

    UniquePtr(const UniquePtr&) = delete;
    UniquePtr& operator=(const UniquePtr&) = delete;

    UniquePtr(UniquePtr&& other) noexcept : ptr_(other.ptr_) { other.ptr_ = nullptr; }

    // reset(other.release()) is safe for self-move: release() nulls us, reset() re-stores the
    // same pointer and deletes nothing.
    UniquePtr& operator=(UniquePtr&& other) noexcept {
        reset(other.release());
        return *this;
    }

    ~UniquePtr() { delete ptr_; }

    T* get() const noexcept { return ptr_; }
    T& operator*() const { return *ptr_; }
    T* operator->() const noexcept { return ptr_; }
    explicit operator bool() const noexcept { return ptr_ != nullptr; }

    T* release() noexcept {
        T* p = ptr_;
        ptr_ = nullptr;
        return p;
    }

    // Store the new pointer before deleting the old one: the old object's destructor may look at
    // (or reset) this UniquePtr again, and must see a consistent state.
    void reset(T* p = nullptr) noexcept {
        T* old = ptr_;
        ptr_ = p;
        delete old;
    }

    void swap(UniquePtr& other) noexcept { std::swap(ptr_, other.ptr_); }

private:
    T* ptr_ = nullptr;
};

template <class T, class... Args>
UniquePtr<T> makeUnique(Args&&... args) {
    return UniquePtr<T>(new T(std::forward<Args>(args)...));
}

struct Point {
    int x, y;
    Point(int x, int y) : x(x), y(y) {}
};

int main() {
    UniquePtr<Point> a = makeUnique<Point>(1, 2);
    UniquePtr<Point> b = std::move(a);
    std::cout << (a ? "a owns" : "a is null") << ", b->x = " << b->x << '\n';
    b.reset(new Point(3, 4));
    std::cout << "b->y = " << b->y << '\n';
    return 0;
}
