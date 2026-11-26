#include <algorithm>
#include <cstddef>
#include <iostream>
#include <memory>
#include <new>
#include <stdexcept>
#include <type_traits>
#include <utility>

template <class T, std::size_t N>
class InplaceVector {
public:
    InplaceVector() noexcept {}

    // TODO: destructor, copy constructor, copy assignment, move constructor, move assignment
    // (see the statement for exactly which operations each performs and the noexcept rules).

    static constexpr std::size_t capacity() noexcept { return N; }
    std::size_t size() const noexcept { return size_; }
    bool empty() const noexcept { return size_ == 0; }

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

    T* try_push_back(const T& value) {
        (void)value;
        return nullptr;
    }

    T* try_push_back(T&& value) {
        (void)value;
        return nullptr;
    }

    void pop_back() {
    }

    T* insert(const T* pos, const T& value) {
        (void)pos;
        (void)value;
        throw std::logic_error("insert: not implemented");
    }

    T* insert(const T* pos, T&& value) {
        (void)pos;
        (void)value;
        throw std::logic_error("insert: not implemented");
    }

    T* erase(const T* pos) {
        (void)pos;
        throw std::logic_error("erase: not implemented");
    }

    T* erase(const T* first, const T* last) {
        (void)first;
        (void)last;
        throw std::logic_error("erase: not implemented");
    }

    void clear() noexcept {
    }

    T& operator[](std::size_t i) { return begin()[i]; }
    const T& operator[](std::size_t i) const { return begin()[i]; }

    T* begin() noexcept { return reinterpret_cast<T*>(storage_); }
    T* end() noexcept { return begin() + size_; }
    const T* begin() const noexcept { return reinterpret_cast<const T*>(storage_); }
    const T* end() const noexcept { return begin() + size_; }

private:
    alignas(T) unsigned char storage_[N * sizeof(T)];  // room for N elements; only the first size_ are alive
    std::size_t size_ = 0;
};

int main() {
    // "Run" executes this file exactly as written - call your code here to try it out.
    // "Run tests" and "Submit" ignore main() and test InplaceVector<T, N> through a hidden harness
    // (see the statement for what each test operation does).
    return 0;
}
