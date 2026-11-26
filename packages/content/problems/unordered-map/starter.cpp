#include <cstddef>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <utility>

template <class K, class V, class Hash = std::hash<K>, class KeyEqual = std::equal_to<K>>
class HashMap {
public:
    using key_type = K;
    using mapped_type = V;
    using value_type = std::pair<const K, V>;

private:
    struct Node {
        Node* next = nullptr;
        value_type kv;
    };

public:
    class iterator {
    public:
        iterator() = default;

        value_type& operator*() const { return node_->kv; }
        value_type* operator->() const { return &node_->kv; }

        iterator& operator++() {
            // TODO: the next node in this bucket, else the first node of the next non-empty bucket
            return *this;
        }
        iterator operator++(int) {
            iterator old = *this;
            ++*this;
            return old;
        }

        friend bool operator==(const iterator& a, const iterator& b) { return a.node_ == b.node_; }

    private:
        friend class HashMap;
        Node* node_ = nullptr;  // nullptr: end()
    };

    HashMap() noexcept = default;

    // TODO: destructor, copy constructor, copy assignment, move constructor, move assignment
    // (the rule of five; see the statement for what each must do and which must be noexcept).

    std::pair<iterator, bool> insert(const value_type& kv) {
        (void)kv;
        return {end(), false};
    }

    template <class... Args>
    std::pair<iterator, bool> try_emplace(const K& key, Args&&... args) {
        (void)key;
        ((void)args, ...);
        return {end(), false};
    }
    template <class... Args>
    std::pair<iterator, bool> try_emplace(K&& key, Args&&... args) {
        (void)key;
        ((void)args, ...);
        return {end(), false};
    }

    V& operator[](const K& key) { return at(key); }
    V& operator[](K&& key) { return at(key); }

    iterator find(const K& key) {
        (void)key;
        return end();
    }
    bool contains(const K& key) const {
        (void)key;
        return false;
    }
    V& at(const K& key) {
        (void)key;
        throw std::out_of_range("HashMap::at: not implemented");
    }
    const V& at(const K& key) const {
        (void)key;
        throw std::out_of_range("HashMap::at: not implemented");
    }

    std::size_t erase(const K& key) {
        (void)key;
        return 0;
    }
    void clear() {}

    std::size_t size() const { return size_; }
    bool empty() const { return size_ == 0; }
    std::size_t bucket_count() const { return bucketCount_; }
    float load_factor() const { return 0.0f; }
    std::size_t bucket(const K& key) const { return hash_(key) % bucketCount_; }
    std::size_t bucket_size(std::size_t b) const {
        (void)b;
        return 0;
    }
    void rehash(std::size_t n) { (void)n; }
    void reserve(std::size_t n) { rehash(n); }

    iterator begin() { return end(); }
    iterator end() { return iterator(); }

private:
    Node** buckets_ = nullptr;  // bucketCount_ chain heads (nullptr when there are no buckets)
    std::size_t bucketCount_ = 0;
    std::size_t size_ = 0;
    Hash hash_{};
    KeyEqual eq_{};
};

int main() {
    // "Run" executes this file exactly as written - call your code here to try it out.
    // "Run tests" and "Submit" ignore main() and test HashMap<K, V, Hash, KeyEqual> through a
    // hidden harness (see the statement for what each test operation does).
    return 0;
}
