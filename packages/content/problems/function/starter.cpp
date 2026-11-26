#include <cstddef>
#include <functional>  // std::bad_function_call, std::invoke
#include <iostream>
#include <memory>
#include <type_traits>
#include <utility>

template <class Signature>
class Function;  // only function types R(Args...) are supported: see the specialisation

template <class R, class... Args>
class Function<R(Args...)> {
public:
    Function() noexcept = default;
    Function(std::nullptr_t) noexcept {}

    // TODO: the converting constructor `template <class F> Function(F&& f)` (constrained: see the
    // statement), copy and move construction and assignment, converting assignment,
    // `operator=(std::nullptr_t)` and the destructor.

    explicit operator bool() const noexcept {
        return false;
    }

    R operator()(Args... args) const {
        ((void)args, ...);
        throw std::bad_function_call();
    }

    void swap(Function& other) noexcept {
        (void)other;
    }

private:
    // TODO: how is a callable of any type stored, copied, called and destroyed?
};

int main() {
    // "Run" executes this file exactly as written - call your code here to try it out.
    // "Run tests" and "Submit" ignore main() and test Function<R(Args...)> through a hidden
    // harness (see the statement for what each test operation does).
    return 0;
}
