#include <algorithm>
#include <cstddef>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>
#include <tuple>
#include <utility>

template <class K, class V, class Hash = std::hash<K>, class KeyEqual = std::equal_to<K>>
class HashMap {
public:
    using key_type = K;
    using mapped_type = V;
    using value_type = std::pair<const K, V>;

private:
    // One heap block per element. Rehashing relinks nodes, so elements never move.
    struct Node {
        Node* next = nullptr;
        value_type kv;

        template <class... A>
        explicit Node(A&&... a) : kv(std::forward<A>(a)...) {}
    };

public:
    class iterator {
    public:
        iterator() = default;

        value_type& operator*() const { return node_->kv; }
        value_type* operator->() const { return &node_->kv; }

        iterator& operator++() {
            node_ = node_->next;
            while (!node_ && ++bucket_ != last_) node_ = *bucket_;
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
        iterator(Node* n, Node** bucket, Node** last) : node_(n), bucket_(bucket), last_(last) {}

        Node* node_ = nullptr;   // nullptr: end()
        Node** bucket_ = nullptr;
        Node** last_ = nullptr;  // one past the last bucket
    };

    HashMap() noexcept = default;

    HashMap(const HashMap& other) : hash_(other.hash_), eq_(other.eq_) {
        if (other.bucketCount_ == 0) return;
        buckets_ = new Node*[other.bucketCount_]();
        bucketCount_ = other.bucketCount_;
        try {
            // Same hash function and bucket count: each copy goes into the same bucket index.
            for (std::size_t b = 0; b < bucketCount_; ++b)
                for (Node* n = other.buckets_[b]; n; n = n->next) {
                    Node* copy = new Node(n->kv);
                    copy->next = buckets_[b];
                    buckets_[b] = copy;
                    ++size_;
                }
        } catch (...) {
            clear();
            delete[] buckets_;
            throw;
        }
    }

    HashMap(HashMap&& other) noexcept
        : buckets_(std::exchange(other.buckets_, nullptr)),
          bucketCount_(std::exchange(other.bucketCount_, 0)),
          size_(std::exchange(other.size_, 0)),
          hash_(other.hash_),
          eq_(other.eq_) {}

    HashMap& operator=(const HashMap& other) {
        if (this != &other) {
            HashMap copy(other);
            swap(copy);
        }
        return *this;
    }

    HashMap& operator=(HashMap&& other) noexcept {
        if (this != &other) {
            HashMap taken(std::move(other));
            swap(taken);  // our old elements are destroyed with `taken`
        }
        return *this;
    }

    ~HashMap() {
        clear();
        delete[] buckets_;
    }

    void swap(HashMap& other) noexcept {
        using std::swap;
        swap(buckets_, other.buckets_);
        swap(bucketCount_, other.bucketCount_);
        swap(size_, other.size_);
        swap(hash_, other.hash_);
        swap(eq_, other.eq_);
    }

    // ---- lookup
    iterator find(const K& key) {
        if (bucketCount_ == 0) return end();
        std::size_t b = bucket(key);
        for (Node* n = buckets_[b]; n; n = n->next)
            if (eq_(n->kv.first, key)) return iterator(n, buckets_ + b, buckets_ + bucketCount_);
        return end();
    }

    bool contains(const K& key) const { return findNode(key) != nullptr; }

    V& at(const K& key) { return const_cast<V&>(std::as_const(*this).at(key)); }
    const V& at(const K& key) const {
        Node* n = findNode(key);
        if (!n) throw std::out_of_range("HashMap::at: key not found");
        return n->kv.second;
    }

    // ---- insertion: nothing is constructed when the key is already present
    std::pair<iterator, bool> insert(const value_type& kv) { return emplaceUnique(kv.first, kv); }

    template <class... Args>
    std::pair<iterator, bool> try_emplace(const K& key, Args&&... args) {
        return emplaceUnique(key, std::piecewise_construct, std::forward_as_tuple(key),
                             std::forward_as_tuple(std::forward<Args>(args)...));
    }
    template <class... Args>
    std::pair<iterator, bool> try_emplace(K&& key, Args&&... args) {
        return emplaceUnique(key, std::piecewise_construct, std::forward_as_tuple(std::move(key)),
                             std::forward_as_tuple(std::forward<Args>(args)...));
    }

    V& operator[](const K& key) { return try_emplace(key).first->second; }
    V& operator[](K&& key) { return try_emplace(std::move(key)).first->second; }

    // ---- removal
    std::size_t erase(const K& key) {
        if (bucketCount_ == 0) return 0;
        Node** link = &buckets_[bucket(key)];  // the pointer that points at the current node
        while (*link && !eq_((*link)->kv.first, key)) link = &(*link)->next;
        if (!*link) return 0;
        Node* dead = *link;
        *link = dead->next;
        delete dead;
        --size_;
        return 1;
    }

    void clear() noexcept {
        for (std::size_t b = 0; b < bucketCount_; ++b) {
            while (Node* n = buckets_[b]) {
                buckets_[b] = n->next;
                delete n;
            }
        }
        size_ = 0;
    }

    // ---- size and buckets
    std::size_t size() const noexcept { return size_; }
    bool empty() const noexcept { return size_ == 0; }
    std::size_t bucket_count() const noexcept { return bucketCount_; }
    float load_factor() const noexcept {
        return bucketCount_ ? static_cast<float>(size_) / static_cast<float>(bucketCount_) : 0.0f;
    }
    std::size_t bucket(const K& key) const { return hash_(key) % bucketCount_; }
    std::size_t bucket_size(std::size_t b) const {
        std::size_t n = 0;
        for (Node* p = buckets_[b]; p; p = p->next) ++n;
        return n;
    }

    // Relinks every node into a new array of max(n, size()) buckets, if that is more than now.
    void rehash(std::size_t n) {
        n = std::max(n, size_);
        if (n <= bucketCount_) return;
        Node** fresh = new Node*[n]();
        for (std::size_t b = 0; b < bucketCount_; ++b) {
            while (Node* p = buckets_[b]) {
                buckets_[b] = p->next;
                std::size_t to = hash_(p->kv.first) % n;
                p->next = fresh[to];
                fresh[to] = p;
            }
        }
        delete[] buckets_;
        buckets_ = fresh;
        bucketCount_ = n;
    }
    void reserve(std::size_t n) { rehash(n); }  // max_load_factor() is 1

    // ---- iteration (bucket by bucket; the order is unspecified)
    iterator begin() {
        for (std::size_t b = 0; b < bucketCount_; ++b)
            if (buckets_[b]) return iterator(buckets_[b], buckets_ + b, buckets_ + bucketCount_);
        return end();
    }
    iterator end() { return iterator(); }

private:
    Node* findNode(const K& key) const {
        if (bucketCount_ == 0) return nullptr;
        for (Node* n = buckets_[bucket(key)]; n; n = n->next)
            if (eq_(n->kv.first, key)) return n;
        return nullptr;
    }

    // Looks the key up first; only if it is absent grows the table and builds a node from args.
    template <class... Args>
    std::pair<iterator, bool> emplaceUnique(const K& key, Args&&... args) {
        if (iterator it = find(key); it != end()) return {it, false};
        if (size_ + 1 > bucketCount_) rehash(bucketCount_ == 0 ? 8 : 2 * bucketCount_);
        Node* n = new Node(std::forward<Args>(args)...);
        std::size_t b = bucket(n->kv.first);
        n->next = buckets_[b];
        buckets_[b] = n;
        ++size_;
        return {iterator(n, buckets_ + b, buckets_ + bucketCount_), true};
    }

    Node** buckets_ = nullptr;  // bucketCount_ chains (nullptr when there are no buckets)
    std::size_t bucketCount_ = 0;
    std::size_t size_ = 0;
    [[no_unique_address]] Hash hash_{};
    [[no_unique_address]] KeyEqual eq_{};
};

int main() {
    HashMap<std::string, int> counts;
    for (const char* w : {"to", "be", "or", "not", "to", "be"}) ++counts[w];
    std::cout << counts.size() << " words, " << counts.bucket_count() << " buckets\n";  // 4 words, 8 buckets
    for (auto& [word, n] : counts) std::cout << word << ' ' << n << '\n';
    std::cout << counts.at("be") << ' ' << counts.contains("question") << '\n';  // 2 0
    counts.erase("to");
    try {
        counts.at("to");
    } catch (const std::out_of_range& e) {
        std::cout << e.what() << '\n';
    }
    return 0;
}
