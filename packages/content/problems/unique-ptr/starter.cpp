#include <cstddef>
#include <iostream>
#include <utility>

template <class T>
class UniquePtr {
public:
    // TODO: constructors, destructor, and the copy/move operations (see the statement for
    // exactly which ones must exist, which must be deleted, and which must be noexcept).

    T* get() const noexcept {
        return nullptr;
    }

    T& operator*() const {
        return *get();
    }

    T* operator->() const noexcept {
        return get();
    }

    explicit operator bool() const noexcept {
        return false;
    }

    T* release() noexcept {
        return nullptr;
    }

    void reset(T* p = nullptr) noexcept {
        (void)p;
    }

    void swap(UniquePtr& other) noexcept {
        (void)other;
    }

private:
    T* ptr_ = nullptr;
};

// TODO: template <class T, class... Args> UniquePtr<T> makeUnique(Args&&... args)

int main() {
    // "Run" executes this file exactly as written - call your code here to try it out.
    // "Run tests" and "Submit" ignore main() and test UniquePtr<T> through a hidden harness
    // (see the statement for what each test operation does).
    return 0;
}
