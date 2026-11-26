#include <iostream>
#include <memory>
#include <new>
#include <optional>  // std::bad_optional_access only
#include <string>
#include <type_traits>
#include <utility>

template <class T>
class Optional {
public:
    Optional() noexcept {}

    Optional(const T& value) { construct(value); }
    Optional(T&& value) { construct(std::move(value)); }

    Optional(const Optional& other) {
        if (other.engaged_) construct(other.value_);
    }

    // Moving leaves other engaged (holding a moved-from T), exactly like std::optional.
    Optional(Optional&& other) noexcept(std::is_nothrow_move_constructible_v<T>) {
        if (other.engaged_) construct(std::move(other.value_));
    }

    // Both engaged: assign the values. Only other engaged: construct. Only *this: destroy.
    Optional& operator=(const Optional& other) {
        if (engaged_ && other.engaged_) value_ = other.value_;
        else if (other.engaged_) construct(other.value_);
        else reset();
        return *this;
    }

    Optional& operator=(Optional&& other) noexcept(std::is_nothrow_move_constructible_v<T> &&
                                                   std::is_nothrow_move_assignable_v<T>) {
        if (engaged_ && other.engaged_) value_ = std::move(other.value_);
        else if (other.engaged_) construct(std::move(other.value_));
        else reset();
        return *this;
    }

    ~Optional() { reset(); }

    // Destroys the current value first; if T's constructor throws, *this is left empty.
    template <class... Args>
    T& emplace(Args&&... args) {
        reset();
        construct(std::forward<Args>(args)...);
        return value_;
    }

    void reset() noexcept {
        if (engaged_) {
            engaged_ = false;
            value_.~T();
        }
    }

    bool has_value() const noexcept { return engaged_; }
    explicit operator bool() const noexcept { return engaged_; }

    T& value() {
        if (!engaged_) throw std::bad_optional_access();
        return value_;
    }
    const T& value() const {
        if (!engaged_) throw std::bad_optional_access();
        return value_;
    }

    T& operator*() noexcept { return value_; }
    const T& operator*() const noexcept { return value_; }
    T* operator->() noexcept { return std::addressof(value_); }
    const T* operator->() const noexcept { return std::addressof(value_); }

    // The fallback is converted to T only when it is needed.
    template <class U>
    T value_or(U&& fallback) const {
        if (engaged_) return value_;
        return static_cast<T>(std::forward<U>(fallback));
    }

private:
    // Precondition: !engaged_. The flag is set only once the constructor has succeeded.
    template <class... Args>
    void construct(Args&&... args) {
        std::construct_at(std::addressof(value_), std::forward<Args>(args)...);
        engaged_ = true;
    }

    // A union member is not constructed or destroyed automatically: its lifetime is ours to
    // manage, and the union gives storage of exactly the right size and alignment for T.
    union {
        T value_;
    };
    bool engaged_ = false;
};

struct Point {
    int x, y;
    Point(int x, int y) : x(x), y(y) {}  // no default constructor
};

int main() {
    Optional<Point> p;
    std::cout << std::boolalpha << p.has_value() << '\n';  // false
    p.emplace(3, 4);
    std::cout << p->x << ',' << p->y << '\n';  // 3,4
    Optional<std::string> a(std::string("hello"));
    Optional<std::string> b = std::move(a);
    std::cout << bool(a) << " '" << *a << "' " << *b << '\n';  // true '' hello
    a.reset();
    std::cout << a.value_or("fallback") << '\n';
    try {
        a.value();
    } catch (const std::bad_optional_access& e) {
        std::cout << "empty: " << e.what() << '\n';
    }
    return 0;
}
