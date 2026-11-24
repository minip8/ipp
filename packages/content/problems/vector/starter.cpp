#include <cstddef>
#include <iostream>
#include <new>
#include <stdexcept>
#include <utility>

template <class T>
class Vector {
public:
    Vector() noexcept = default;

    // TODO: destructor, copy constructor, copy assignment, move constructor, move assignment
    // (the rule of five; see the statement for what each must do and which must be noexcept).

    void push_back(const T& value) {
        (void)value;
    }

    void push_back(T&& value) {
        (void)value;
    }

    template <class... Args>
    T& emplace_back(Args&&... args) {
        ((void)args, ...);
        throw std::logic_error("emplace_back: not implemented");
    }

    void pop_back() {
    }

    T& operator[](std::size_t i) { return data_[i]; }
    const T& operator[](std::size_t i) const { return data_[i]; }

    T& at(std::size_t i) {
        (void)i;
        throw std::logic_error("at: not implemented");
    }
    const T& at(std::size_t i) const {
        (void)i;
        throw std::logic_error("at: not implemented");
    }

    std::size_t size() const noexcept { return size_; }
    std::size_t capacity() const noexcept { return cap_; }
    bool empty() const noexcept { return size_ == 0; }

    void reserve(std::size_t n) {
        (void)n;
    }

    void clear() noexcept {
    }

    T* begin() noexcept { return data_; }
    T* end() noexcept { return data_ + size_; }
    const T* begin() const noexcept { return data_; }
    const T* end() const noexcept { return data_ + size_; }

private:
    T* data_ = nullptr;     // raw storage for cap_ elements; only the first size_ are constructed
    std::size_t size_ = 0;
    std::size_t cap_ = 0;
};

int main() {
    // "Run" executes this file exactly as written - call your code here to try it out.
    // "Run tests" and "Submit" ignore main() and test Vector<T> through a hidden harness
    // (see the statement for what each test operation does).
    return 0;
}
