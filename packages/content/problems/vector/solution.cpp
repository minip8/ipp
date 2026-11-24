#include <cstddef>
#include <iostream>
#include <new>
#include <stdexcept>
#include <string>
#include <utility>

template <class T>
class Vector {
public:
    Vector() noexcept = default;

    Vector(const Vector& other) : data_(allocate(other.size_)), cap_(other.size_) {
        try {
            for (; size_ < other.size_; ++size_) ::new (static_cast<void*>(data_ + size_)) T(other.data_[size_]);
        } catch (...) {
            destroyAll();
            deallocate(data_);
            throw;
        }
    }

    Vector(Vector&& other) noexcept : data_(other.data_), size_(other.size_), cap_(other.cap_) {
        other.data_ = nullptr;
        other.size_ = other.cap_ = 0;
    }

    // Copy-and-swap gives the strong guarantee; the self check avoids copying for v = v.
    Vector& operator=(const Vector& other) {
        if (this != &other) {
            Vector tmp(other);
            swap(tmp);
        }
        return *this;
    }

    Vector& operator=(Vector&& other) noexcept {
        if (this != &other) {
            Vector tmp(std::move(other));
            swap(tmp);
        }
        return *this;
    }

    ~Vector() {
        destroyAll();
        deallocate(data_);
    }

    void push_back(const T& value) { emplace_back(value); }
    void push_back(T&& value) { emplace_back(std::move(value)); }

    template <class... Args>
    T& emplace_back(Args&&... args) {
        if (size_ == cap_) return growAndEmplace(cap_ ? cap_ * 2 : 1, std::forward<Args>(args)...);
        T* p = ::new (static_cast<void*>(data_ + size_)) T(std::forward<Args>(args)...);
        ++size_;
        return *p;
    }

    void pop_back() {
        --size_;
        data_[size_].~T();
    }

    T& operator[](std::size_t i) { return data_[i]; }
    const T& operator[](std::size_t i) const { return data_[i]; }

    T& at(std::size_t i) {
        if (i >= size_) throw std::out_of_range("Vector::at: index " + std::to_string(i) + " >= size " + std::to_string(size_));
        return data_[i];
    }
    const T& at(std::size_t i) const { return const_cast<Vector*>(this)->at(i); }

    std::size_t size() const noexcept { return size_; }
    std::size_t capacity() const noexcept { return cap_; }
    bool empty() const noexcept { return size_ == 0; }

    void reserve(std::size_t n) {
        if (n <= cap_) return;
        T* fresh = allocate(n);
        relocateInto(fresh, false);
        cap_ = n;
    }

    void clear() noexcept { destroyAll(); }

    T* begin() noexcept { return data_; }
    T* end() noexcept { return data_ + size_; }
    const T* begin() const noexcept { return data_; }
    const T* end() const noexcept { return data_ + size_; }

    void swap(Vector& other) noexcept {
        std::swap(data_, other.data_);
        std::swap(size_, other.size_);
        std::swap(cap_, other.cap_);
    }

private:
    // Raw storage only: no T is constructed until an element is added.
    static T* allocate(std::size_t n) {
        return n ? static_cast<T*>(::operator new(n * sizeof(T))) : nullptr;
    }
    static void deallocate(T* p) noexcept { ::operator delete(static_cast<void*>(p)); }

    void destroyAll() noexcept {
        while (size_ > 0) data_[--size_].~T();
    }

    // Moves the elements into fresh storage (copying only if T's move could throw), then
    // destroys the old elements and frees the old storage. Takes ownership of fresh; on failure
    // also destroys the extra element already built at fresh[size_] if there is one.
    void relocateInto(T* fresh, bool extra) {
        std::size_t done = 0;
        try {
            for (; done < size_; ++done) ::new (static_cast<void*>(fresh + done)) T(std::move_if_noexcept(data_[done]));
        } catch (...) {
            while (done > 0) fresh[--done].~T();
            if (extra) fresh[size_].~T();
            deallocate(fresh);
            throw;
        }
        std::size_t n = size_;
        destroyAll();
        deallocate(data_);
        data_ = fresh;
        size_ = n;
    }

    // Constructs the new element in the new storage *before* touching the old elements: args
    // may refer to one of them (v.push_back(v[0])).
    template <class... Args>
    T& growAndEmplace(std::size_t newCap, Args&&... args) {
        T* fresh = allocate(newCap);
        T* p;
        try {
            p = ::new (static_cast<void*>(fresh + size_)) T(std::forward<Args>(args)...);
        } catch (...) {
            deallocate(fresh);
            throw;
        }
        relocateInto(fresh, true);
        cap_ = newCap;
        ++size_;
        return *p;
    }

    T* data_ = nullptr;
    std::size_t size_ = 0;
    std::size_t cap_ = 0;
};

struct Point {
    int x, y;
    Point(int x, int y) : x(x), y(y) {}  // no default constructor
};

int main() {
    Vector<Point> v;
    for (int i = 0; i < 5; ++i) v.emplace_back(i, i * i);
    v.push_back(v[0]);
    std::cout << "size " << v.size() << ", capacity " << v.capacity() << '\n';  // 6, 8
    for (const Point& p : v) std::cout << '(' << p.x << ',' << p.y << ") ";
    std::cout << '\n';
    try {
        v.at(10);
    } catch (const std::out_of_range& e) {
        std::cout << e.what() << '\n';
    }
    return 0;
}
