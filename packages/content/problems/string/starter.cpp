#include <cstddef>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <utility>

class String {
public:
    static constexpr std::size_t npos = static_cast<std::size_t>(-1);

    String() noexcept = default;

    String(const char* s) {
        (void)s;
    }

    String(std::size_t count, char ch) {
        (void)count;
        (void)ch;
    }

    // TODO: destructor, copy constructor, copy assignment, move constructor, move assignment
    // (the rule of five; see the statement for what each must do and which must be noexcept).

    std::size_t size() const noexcept { return size_; }
    std::size_t capacity() const noexcept { return cap_; }
    bool empty() const noexcept { return size_ == 0; }

    const char* c_str() const noexcept {
        return data_;  // TODO: must never be null, and must be null-terminated
    }

    char& operator[](std::size_t i) { return data_[i]; }
    const char& operator[](std::size_t i) const { return data_[i]; }

    void push_back(char c) {
        (void)c;
    }

    String& append(const char* s) {
        (void)s;
        return *this;
    }

    String& append(const String& s) {
        (void)s;
        return *this;
    }

    String& operator+=(const String& s) { return append(s); }

    String& operator+=(char c) {
        push_back(c);
        return *this;
    }

    void reserve(std::size_t n) {
        (void)n;
    }

    void clear() noexcept {
    }

    String substr(std::size_t pos = 0, std::size_t count = npos) const {
        (void)pos;
        (void)count;
        throw std::logic_error("substr: not implemented");
    }

    std::size_t find(const String& needle, std::size_t pos = 0) const {
        (void)needle;
        (void)pos;
        return npos;
    }

    friend bool operator==(const String& a, const String& b) {
        (void)a;
        (void)b;
        return false;
    }

    friend bool operator<(const String& a, const String& b) {
        (void)a;
        (void)b;
        return false;
    }

private:
    char* data_ = nullptr;  // capacity() + 1 bytes, or null when capacity() == 0
    std::size_t size_ = 0;
    std::size_t cap_ = 0;
};

int main() {
    // "Run" executes this file exactly as written - call your code here to try it out.
    // "Run tests" and "Submit" ignore main() and test String through a hidden harness
    // (see the statement for what each test operation does).
    return 0;
}
