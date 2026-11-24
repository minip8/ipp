// interview++ judge: C++ driver support. Precompiled (with <bits/stdc++.h>) into the sandbox image
// and force-included before the candidate's code, so the candidate's macros cannot affect it. The
// non-template parts live in support.cpp (built into /opt/ipp/lib/libippdriver.a), so each job only
// compiles the candidate's code plus the few template instantiations its signature needs.
//
// The judge appends a generated part after the candidate's code (see crates/judge-harness/src/cpp.rs):
//   make / destroy / call functions for the candidate's class, and main() -> __ipp::run_loop(...).
//
// Wire protocol (shared with the Python and Java drivers; see apps/judge/README.md):
//   fd 3, one JSON document per line:
//     header  {"nonce": "...", ...}
//     test    {"ctorArgs": [...], "calls": [{"method": "name", "args": [...]}, ...]}
//   stdout, frames "\x1eIPP<nonce>\x1f" + JSON + "\n" (the candidate's own prints go around them):
//     {"t":"ready"}
//     {"t":"result","ok":true,"values":[...],"ms":1.5,"rssKb":1234}
//     {"t":"result","ok":false,"kind":"exception"|"memory"|"input","error":"...","ms":1.5,"rssKb":1234}
#pragma once
#include <bits/stdc++.h>

namespace __ipp {

struct Json {
    enum Kind { Null, Bool, Num, Str, Arr, Obj } kind = Null;
    bool b = false;
    double num = 0;
    bool is_int = false;
    long long ival = 0;
    std::string str;
    std::vector<Json> arr;
    std::vector<std::pair<std::string, Json>> obj;

    const Json* get(const std::string& k) const;
};

/// Input from the judge that does not fit the candidate's parameter types (reported per test).
struct BadInput : std::runtime_error {
    using std::runtime_error::runtime_error;
};

Json parse(const std::string& s);
void write_string(std::string& out, std::string_view v);
void write_double(std::string& out, double v);

// ---------- JSON -> C++ ----------
template <class T> struct is_vector : std::false_type {};
template <class T, class A> struct is_vector<std::vector<T, A>> : std::true_type {};

template <class T> T from_json(const Json& j) {
    using U = std::remove_cvref_t<T>;
    if constexpr (std::is_same_v<U, bool>) {
        if (j.kind != Json::Bool) throw BadInput("expected a boolean argument");
        return j.b;
    } else if constexpr (std::is_same_v<U, char>) {
        if (j.kind != Json::Str || j.str.size() != 1) throw BadInput("expected a one-character string argument");
        return j.str[0];
    } else if constexpr (std::is_integral_v<U>) {
        if (j.kind != Json::Num || !j.is_int) throw BadInput("expected an integer argument");
        return static_cast<U>(j.ival);
    } else if constexpr (std::is_floating_point_v<U>) {
        if (j.kind != Json::Num) throw BadInput("expected a number argument");
        return static_cast<U>(j.num);
    } else if constexpr (std::is_same_v<U, std::string>) {
        if (j.kind != Json::Str) throw BadInput("expected a string argument");
        return j.str;
    } else if constexpr (is_vector<U>::value) {
        if (j.kind != Json::Arr) throw BadInput("expected an array argument");
        U out;
        out.reserve(j.arr.size());
        for (auto& e : j.arr) out.push_back(from_json<typename U::value_type>(e));
        return out;
    } else {
        static_assert(sizeof(U) == 0, "interview++: unsupported parameter type");
    }
}

// ---------- C++ -> JSON ----------
template <class T, class = void> struct is_range : std::false_type {};
template <class T>
struct is_range<T, std::void_t<decltype(std::begin(std::declval<const T&>())), decltype(std::end(std::declval<const T&>()))>>
    : std::true_type {};
template <class T> struct is_pairlike : std::false_type {};
template <class A, class B> struct is_pairlike<std::pair<A, B>> : std::true_type {};
template <class... A> struct is_pairlike<std::tuple<A...>> : std::true_type {};
template <class T> struct is_optional : std::false_type {};
template <class T> struct is_optional<std::optional<T>> : std::true_type {};

template <class T> void write(std::string& out, const T& v) {
    using U = std::remove_cvref_t<T>;
    if constexpr (std::is_same_v<U, bool>) {
        out += v ? "true" : "false";
    } else if constexpr (std::is_same_v<U, char>) {
        write_string(out, std::string_view(&v, 1));
    } else if constexpr (std::is_integral_v<U>) {
        out += std::to_string(v);
    } else if constexpr (std::is_floating_point_v<U>) {
        write_double(out, (double)v);
    } else if constexpr (std::is_convertible_v<const U&, std::string_view>) {
        write_string(out, std::string_view(v));
    } else if constexpr (is_optional<U>::value) {
        if (v) write(out, *v);
        else out += "null";
    } else if constexpr (is_pairlike<U>::value) {
        out += '[';
        bool first = true;
        std::apply([&](const auto&... e) { ((out += first ? "" : ",", first = false, write(out, e)), ...); }, v);
        out += ']';
    } else if constexpr (is_range<U>::value) {
        out += '[';
        bool first = true;
        for (auto&& e : v) {
            if (!first) out += ',';
            first = false;
            write(out, static_cast<std::remove_cvref_t<decltype(*std::begin(v))>>(e));
        }
        out += ']';
    } else {
        static_assert(sizeof(U) == 0, "interview++: unsupported return type");
    }
}

// ---------- calling candidate methods ----------
using Clock = std::chrono::steady_clock;

inline double ms_since(Clock::time_point t0) {
    return std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
}

struct CallOut {
    std::string json;
    double ms = 0;
};

template <class... A> std::tuple<std::remove_cvref_t<A>...> make_args(const std::vector<Json>& args) {
    if (args.size() != sizeof...(A))
        throw BadInput("expected " + std::to_string(sizeof...(A)) + " arguments, got " + std::to_string(args.size()));
    return [&]<size_t... I>(std::index_sequence<I...>) {
        return std::tuple<std::remove_cvref_t<A>...>{from_json<std::remove_cvref_t<A>>(args[I])...};
    }(std::index_sequence_for<A...>{});
}

template <class R, class F> CallOut timed(F&& f) {
    auto t0 = Clock::now();
    if constexpr (std::is_void_v<R>) {
        f();
        return {"null", ms_since(t0)};
    } else {
        decltype(auto) r = f();
        CallOut o{"", ms_since(t0)};
        write(o.json, r);
        return o;
    }
}

#define IPP_MEMBER_INVOKE(QUAL)                                                                           \
    template <class Obj, class C, class R, class... A>                                                    \
    CallOut invoke(Obj& obj, R (C::*f)(A...) QUAL, const std::vector<Json>& args) {                       \
        auto t = make_args<A...>(args);                                                                   \
        return timed<R>([&]() -> decltype(auto) {                                                         \
            return std::apply([&](auto&... a) -> decltype(auto) { return (obj.*f)(static_cast<A&&>(a)...); }, t); \
        });                                                                                               \
    }
IPP_MEMBER_INVOKE()
IPP_MEMBER_INVOKE(const)
IPP_MEMBER_INVOKE(noexcept)
IPP_MEMBER_INVOKE(const noexcept)
IPP_MEMBER_INVOKE(&)
IPP_MEMBER_INVOKE(const&)
#undef IPP_MEMBER_INVOKE

template <class Obj, class R, class... A> CallOut invoke(Obj&, R (*f)(A...), const std::vector<Json>& args) {
    auto t = make_args<A...>(args);
    return timed<R>([&]() -> decltype(auto) {
        return std::apply([&](auto&... a) -> decltype(auto) { return f(static_cast<A&&>(a)...); }, t);
    });
}
template <class Obj, class R, class... A>
CallOut invoke(Obj& o, R (*f)(A...) noexcept, const std::vector<Json>& args) {
    R (*g)(A...) = f;
    return invoke(o, g, args);
}

/// The candidate's class, type-erased by the generated code.
struct Erased {
    /// Constructs the object from the constructor arguments; adds the construction time to ms.
    void* (*make)(const std::vector<Json>& args, double& ms);
    void (*destroy)(void* obj);
    CallOut (*call)(void* obj, const std::string& method, const std::vector<Json>& args);
};

/// The driver loop (support.cpp).
int run_loop(const Erased& cls);

}  // namespace __ipp
