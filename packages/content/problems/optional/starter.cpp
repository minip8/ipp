#include <iostream>
#include <memory>
#include <new>
#include <optional>  // only for std::bad_optional_access
#include <stdexcept>
#include <type_traits>
#include <utility>

template <class T>
class Optional {
public:
    Optional() noexcept {}

    // TODO: Optional(const T&), Optional(T&&), destructor, copy/move constructors and copy/move
    // assignment (see the statement for the four assignment cases and the noexcept rules).

    template <class... Args>
    T& emplace(Args&&... args) {
        ((void)args, ...);
        throw std::logic_error("emplace: not implemented");
    }

    void reset() noexcept {
    }

    bool has_value() const noexcept { return engaged_; }
    explicit operator bool() const noexcept { return engaged_; }

    T& value() {
        throw std::bad_optional_access();
    }
    const T& value() const {
        throw std::bad_optional_access();
    }

    T& operator*() { return *ptr(); }
    const T& operator*() const { return *ptr(); }
    T* operator->() { return ptr(); }
    const T* operator->() const { return ptr(); }

    template <class U>
    T value_or(U&& fallback) const {
        return static_cast<T>(std::forward<U>(fallback));
    }

private:
    T* ptr() { return std::launder(reinterpret_cast<T*>(storage_)); }
    const T* ptr() const { return std::launder(reinterpret_cast<const T*>(storage_)); }

    alignas(T) unsigned char storage_[sizeof(T)];  // holds a T only while engaged_ is true
    bool engaged_ = false;
};

int main() {
    // "Run" executes this file exactly as written - call your code here to try it out.
    // "Run tests" and "Submit" ignore main() and test Optional<T> through a hidden harness
    // (see the statement for what each test operation does).
    return 0;
}
