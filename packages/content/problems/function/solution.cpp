#include <cstddef>
#include <cstdio>      // std::puts
#include <functional>  // std::bad_function_call, std::invoke
#include <iostream>
#include <memory>
#include <type_traits>
#include <utility>

template <class Signature>
class Function;  // only function types R(Args...) are supported: see the specialisation

template <class R, class... Args>
class Function<R(Args...)> {
    // Type erasure: Callable is the interface every stored callable is used through; Holder<F>
    // is the one implementation per callable type, created by the converting constructor (the
    // only place that still knows F).
    struct Callable {
        virtual ~Callable() = default;
        virtual R call(Args&&... args) = 0;
        virtual std::unique_ptr<Callable> clone() const = 0;
    };

    template <class F>
    struct Holder final : Callable {
        F f;

        template <class U>
        explicit Holder(U&& u) : f(std::forward<U>(u)) {}

        // Non-const: a functor or mutable lambda may change its own state when called.
        R call(Args&&... args) override {
            if constexpr (std::is_void_v<R>)
                std::invoke(f, std::forward<Args>(args)...);  // discard any result
            else
                return std::invoke(f, std::forward<Args>(args)...);
        }

        std::unique_ptr<Callable> clone() const override { return std::make_unique<Holder>(f); }
    };

    // A converting constructor that accepted Function itself would win over the copy constructor
    // for a non-const lvalue (F&& = Function& is a better match than const Function&) and wrap
    // the Function instead of copying it.
    template <class F>
    static constexpr bool kAccepts = !std::is_same_v<std::remove_cvref_t<F>, Function> &&
                                     std::is_invocable_r_v<R, std::decay_t<F>&, Args...>;

public:
    Function() noexcept = default;
    Function(std::nullptr_t) noexcept {}

    template <class F>
        requires kAccepts<F>
    Function(F&& f) : callable_(std::make_unique<Holder<std::decay_t<F>>>(std::forward<F>(f))) {}

    Function(const Function& other) : callable_(other.callable_ ? other.callable_->clone() : nullptr) {}
    Function(Function&& other) noexcept = default;  // steals the pointer; other is left empty

    Function& operator=(const Function& other) {
        if (this != &other) Function(other).swap(*this);  // strong guarantee: clone first
        return *this;
    }
    Function& operator=(Function&& other) noexcept = default;  // unique_ptr's: self-move safe

    template <class F>
        requires kAccepts<F>
    Function& operator=(F&& f) {
        Function(std::forward<F>(f)).swap(*this);
        return *this;
    }

    Function& operator=(std::nullptr_t) noexcept {
        callable_.reset();
        return *this;
    }

    ~Function() = default;

    explicit operator bool() const noexcept { return callable_ != nullptr; }

    R operator()(Args... args) const {
        if (!callable_) throw std::bad_function_call();
        return callable_->call(std::forward<Args>(args)...);
    }

    void swap(Function& other) noexcept { callable_.swap(other.callable_); }

private:
    std::unique_ptr<Callable> callable_;
};

int square(int x) { return x * x; }

int main() {
    Function<int(int)> f = square;
    std::cout << f(7) << '\n';  // 49

    int calls = 0;
    f = [&calls, total = 0](int x) mutable {
        ++calls;
        return total += x;
    };
    Function<int(int)> g = f;  // g gets its own copy of the lambda, including total
    f(1);
    f(2);
    std::cout << f(3) << ' ' << g(10) << ' ' << calls << '\n';  // 6 10 4

    Function<void(const char*)> say = [](const char* s) { return std::puts(s); };  // result ignored
    say("hello");

    Function<int(int)> empty;
    try {
        empty(1);
    } catch (const std::bad_function_call&) {
        std::cout << "empty Function: bad_function_call\n";
    }
    return 0;
}
