#include <cstddef>
#include <iostream>
#include <utility>

template <class T>
class SharedPtr {
public:
    // TODO: constructors, destructor, and the copy/move operations (see the statement for
    // exactly which ones must exist and which must be noexcept).

    T* get() const noexcept {
        return nullptr;
    }

    T& operator*() const noexcept {
        return *get();
    }

    T* operator->() const noexcept {
        return get();
    }

    explicit operator bool() const noexcept {
        return false;
    }

    long use_count() const noexcept {
        return 0;
    }

    void reset() noexcept {
    }

    void reset(T* p) {
        (void)p;
    }

    void swap(SharedPtr& other) noexcept {
        (void)other;
    }

private:
    // TODO: what does each SharedPtr need to store, and where does the count live?
};

int main() {
    // "Run" executes this file exactly as written - call your code here to try it out.
    // "Run tests" and "Submit" ignore main() and test SharedPtr<T> through a hidden harness
    // (see the statement for what each test operation does).
    return 0;
}
