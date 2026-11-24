#include <cstddef>
#include <iostream>
#include <utility>

template <class T>
class SharedPtr {
    // One per owned object, shared by every SharedPtr that owns it.
    struct ControlBlock {
        long count;
    };

public:
    SharedPtr() noexcept = default;

    // If allocating the control block throws, nobody owns p yet: delete it before rethrowing.
    explicit SharedPtr(T* p) : ptr_(p) {
        try {
            cb_ = new ControlBlock{1};
        } catch (...) {
            delete p;
            throw;
        }
    }

    SharedPtr(const SharedPtr& other) noexcept : ptr_(other.ptr_), cb_(other.cb_) {
        if (cb_) ++cb_->count;
    }

    SharedPtr(SharedPtr&& other) noexcept : ptr_(other.ptr_), cb_(other.cb_) {
        other.ptr_ = nullptr;
        other.cb_ = nullptr;
    }

    // Copy-and-swap: the copy takes its reference before ours is dropped, so self-assignment and
    // assigning a pointer that shares our object are both safe.
    SharedPtr& operator=(const SharedPtr& other) noexcept {
        SharedPtr(other).swap(*this);
        return *this;
    }

    SharedPtr& operator=(SharedPtr&& other) noexcept {
        SharedPtr(std::move(other)).swap(*this);
        return *this;
    }

    ~SharedPtr() {
        if (cb_ && --cb_->count == 0) {
            delete ptr_;
            delete cb_;
        }
    }

    T* get() const noexcept { return ptr_; }
    T& operator*() const noexcept { return *ptr_; }
    T* operator->() const noexcept { return ptr_; }
    explicit operator bool() const noexcept { return ptr_ != nullptr; }
    long use_count() const noexcept { return cb_ ? cb_->count : 0; }

    void reset() noexcept { SharedPtr().swap(*this); }
    void reset(T* p) { SharedPtr(p).swap(*this); }

    void swap(SharedPtr& other) noexcept {
        std::swap(ptr_, other.ptr_);
        std::swap(cb_, other.cb_);
    }

private:
    T* ptr_ = nullptr;
    ControlBlock* cb_ = nullptr;
};

struct Noisy {
    int id;
    explicit Noisy(int id) : id(id) {}
    ~Noisy() { std::cout << "destroying " << id << '\n'; }
};

int main() {
    SharedPtr<Noisy> a(new Noisy(1));
    {
        SharedPtr<Noisy> b = a;
        std::cout << "use_count = " << a.use_count() << '\n';  // 2
    }
    std::cout << "use_count = " << a.use_count() << '\n';  // 1
    a.reset(new Noisy(2));                                  // destroys 1
    return 0;                                               // destroys 2
}
