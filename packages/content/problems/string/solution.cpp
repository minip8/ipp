#include <algorithm>
#include <compare>
#include <cstddef>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <utility>

class String {
public:
    static constexpr std::size_t npos = static_cast<std::size_t>(-1);

    String() noexcept = default;

    String(const char* s) : String(s, std::strlen(s), Exact{}) {}

    String(std::size_t count, char ch) : String(nullptr, count, Exact{}) {
        if (count) std::memset(data_, ch, count);
    }

    String(const String& other) : String(other.c_str(), other.size_, Exact{}) {}

    String(String&& other) noexcept
        : data_(std::exchange(other.data_, nullptr)),
          size_(std::exchange(other.size_, 0)),
          cap_(std::exchange(other.cap_, 0)) {}

    // Reuses the buffer when the copy fits (no allocation, like std::string); otherwise
    // copy-and-swap, which leaves *this untouched if the allocation throws.
    String& operator=(const String& other) {
        if (this == &other) return *this;
        if (other.size_ > cap_) {
            String tmp(other);
            swap(tmp);
        } else {
            if (other.size_) std::memcpy(data_, other.data_, other.size_);
            setSize(other.size_);
        }
        return *this;
    }

    String& operator=(String&& other) noexcept {
        if (this != &other) {
            String tmp(std::move(other));
            swap(tmp);
        }
        return *this;
    }

    ~String() { delete[] data_; }

    std::size_t size() const noexcept { return size_; }
    std::size_t capacity() const noexcept { return cap_; }
    bool empty() const noexcept { return size_ == 0; }

    // Never null: a String without a buffer is the empty string.
    const char* c_str() const noexcept { return data_ ? data_ : ""; }

    char& operator[](std::size_t i) { return data_[i]; }
    const char& operator[](std::size_t i) const { return data_[i]; }

    void push_back(char c) { appendRange(&c, 1); }
    String& append(const char* s) { return appendRange(s, std::strlen(s)); }
    String& append(const String& s) { return appendRange(s.c_str(), s.size_); }
    String& operator+=(const String& s) { return append(s); }
    String& operator+=(char c) {
        push_back(c);
        return *this;
    }

    void reserve(std::size_t n) {
        if (n > cap_) reallocate(n);
    }

    void clear() noexcept { setSize(0); }

    String substr(std::size_t pos = 0, std::size_t count = npos) const {
        if (pos > size_) throw std::out_of_range("String::substr: pos > size()");
        return String(c_str() + pos, std::min(count, size_ - pos), Exact{});  // no pos + count overflow
    }

    std::size_t find(const String& needle, std::size_t pos = 0) const noexcept {
        if (pos > size_ || needle.size_ > size_ - pos) return npos;
        for (std::size_t i = pos; i <= size_ - needle.size_; ++i)
            if (std::memcmp(c_str() + i, needle.c_str(), needle.size_) == 0) return i;
        return npos;
    }

    void swap(String& other) noexcept {
        std::swap(data_, other.data_);
        std::swap(size_, other.size_);
        std::swap(cap_, other.cap_);
    }

    // Byte-wise (memcmp compares as unsigned char), over all size() bytes: '\0' is an ordinary
    // character here, so strcmp would be wrong.
    friend bool operator==(const String& a, const String& b) noexcept {
        return a.size_ == b.size_ && std::memcmp(a.c_str(), b.c_str(), a.size_) == 0;
    }
    friend std::strong_ordering operator<=>(const String& a, const String& b) noexcept {
        int c = std::memcmp(a.c_str(), b.c_str(), std::min(a.size_, b.size_));
        if (c != 0) return c <=> 0;
        return a.size_ <=> b.size_;  // a proper prefix is less
    }

private:
    struct Exact {};

    // A String of exactly n characters copied from s (or left for the caller to fill if s is
    // null), with capacity n: one allocation, none when n == 0.
    String(const char* s, std::size_t n, Exact) {
        if (n == 0) return;
        data_ = new char[n + 1];
        if (s) std::memcpy(data_, s, n);
        data_[n] = '\0';
        size_ = cap_ = n;
    }

    void setSize(std::size_t n) noexcept {
        size_ = n;
        if (data_) data_[n] = '\0';
    }

    // Moves the characters into a buffer of exactly newCap (> size_) characters.
    void reallocate(std::size_t newCap) {
        char* fresh = new char[newCap + 1];
        if (size_) std::memcpy(fresh, data_, size_);
        fresh[size_] = '\0';
        delete[] data_;
        data_ = fresh;
        cap_ = newCap;
    }

    // s may point into this string's own buffer (s.append(s), s.append(s.c_str() + 2)), so on
    // growth the characters are copied from s before the old buffer is freed.
    String& appendRange(const char* s, std::size_t n) {
        if (n == 0) return *this;
        if (n > cap_ - size_) {
            std::size_t newCap = std::max(cap_ * 2, size_ + n);
            char* fresh = new char[newCap + 1];
            if (size_) std::memcpy(fresh, data_, size_);
            std::memcpy(fresh + size_, s, n);
            delete[] data_;
            data_ = fresh;
            cap_ = newCap;
        } else {
            std::memmove(data_ + size_, s, n);
        }
        setSize(size_ + n);
        return *this;
    }

    char* data_ = nullptr;  // capacity() + 1 bytes from new[], or null when capacity() == 0
    std::size_t size_ = 0;
    std::size_t cap_ = 0;
};

int main() {
    String s("hello");
    s += ' ';
    s.append("world");
    s.append(s);  // appending to itself works even though it reallocates
    std::cout << s.c_str() << " (size " << s.size() << ", capacity " << s.capacity() << ")\n";
    std::cout << "find(\"world\", 6) = " << s.find(String("world"), 6) << '\n';  // 6
    String t = s.substr(0, 5);
    std::cout << t.c_str() << ' ' << (t < s) << '\n';  // hello 1
    return 0;
}
