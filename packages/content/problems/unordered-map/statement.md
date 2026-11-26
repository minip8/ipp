Implement `HashMap<K, V, Hash, KeyEqual>`, a hash table from keys to values (a subset of `std::unordered_map`) using **separate chaining**: an array of buckets, each the head of a linked list of nodes, with every element living in its own heap-allocated node. Because elements never move once inserted, growing the table only **relinks** nodes into a new bucket array; no key or value is ever copied or moved by a rehash.

Do not use any standard container (`std::vector`, `std::list`, `std::unordered_map`, ...) inside your class. Define everything at global scope (no namespace).

**Required interface**

```cpp
template <class K, class V, class Hash = std::hash<K>, class KeyEqual = std::equal_to<K>>
class HashMap {
public:
    using key_type = K;
    using mapped_type = V;
    using value_type = std::pair<const K, V>;
    class iterator;                                   // see below

    HashMap() noexcept;                               // no buckets, allocates nothing
    HashMap(const HashMap& other);
    HashMap& operator=(const HashMap& other);
    HashMap(HashMap&& other) noexcept;
    HashMap& operator=(HashMap&& other) noexcept;
    ~HashMap();

    std::pair<iterator, bool> insert(const value_type& kv);
    template <class... Args> std::pair<iterator, bool> try_emplace(const K& key, Args&&... args);
    template <class... Args> std::pair<iterator, bool> try_emplace(K&& key, Args&&... args);
    V& operator[](const K& key);
    V& operator[](K&& key);

    iterator find(const K& key);                      // end() if absent
    bool contains(const K& key) const;
    V& at(const K& key);                              // throws std::out_of_range if absent
    const V& at(const K& key) const;

    std::size_t erase(const K& key);                  // number of elements removed (0 or 1)
    void clear();

    std::size_t size() const;
    bool empty() const;
    std::size_t bucket_count() const;
    float load_factor() const;                        // size() / bucket_count(), 0 with no buckets
    std::size_t bucket(const K& key) const;           // only called when bucket_count() > 0
    std::size_t bucket_size(std::size_t b) const;     // number of elements in bucket b
    void rehash(std::size_t n);
    void reserve(std::size_t n);                      // same as rehash(n)

    iterator begin();
    iterator end();
};
```

`iterator` is default constructible and copyable, with `value_type& operator*() const`, `value_type* operator->() const`, prefix and postfix `++`, and `==` / `!=`. From `begin()` to `end()` it visits every element exactly once, in an unspecified order. (A `const_iterator` is not required.)

**Behaviour**

- **Hashing**: an element with key `k` lives in bucket `hash(k) % bucket_count()`, where `hash` is a `Hash` object; keys are compared only with a `KeyEqual` object. `K` need not have `operator==`, a `std::hash` specialisation or a default constructor.
- **Storage**: the bucket array is one heap block (`new Node*[n]()` or similar) of exactly `bucket_count()` entries, and each element is one heap node, allocated with `new`. A map with no buckets allocates nothing.
- **Growth**: a default-constructed map has `bucket_count() == 0`. Before an insertion adds a **new** element, if `size() + 1 > bucket_count()` the map calls `rehash(bucket_count() == 0 ? 8 : 2 * bucket_count())`. So the load factor never exceeds 1. An insertion whose key is already present changes nothing.
- **`rehash(n)`**: if `max(n, size()) > bucket_count()`, moves every node into a new array of exactly `max(n, size())` buckets (by relinking) and frees the old array; otherwise does nothing. Nothing else changes the bucket count except as listed below (in particular, `erase` and `clear` keep it).
- `insert(kv)` and `try_emplace(key, args...)` return an iterator to the element with that key and whether it was inserted. `operator[]` returns the value for `key`, inserting a value-initialised `V()` first if the key is absent.
- `erase(key)` destroys the element's key and value and frees its node. `clear()` does that for every element and keeps the buckets.
- **Copy constructor**: a new map with `other.bucket_count()` buckets holding a copy of each element. **Copy assignment**: afterwards the target holds copies of `other`'s elements and has `other.bucket_count()` buckets; its old elements are destroyed. `m = m` leaves `m` unchanged.
- **Move constructor / move assignment**: take over `other`'s bucket array and nodes without touching any element (move assignment first destroys the target's own elements). `other` is left empty with `bucket_count() == 0`. `m = std::move(m)` leaves `m` unchanged.

**Exact element operations.** Each operation performs only these operations on keys and values and no others (no temporaries, no extra copies or moves):

| Operation | Operations on `K` and `V` |
|---|---|
| `insert(kv)`, key absent | one copy construction of the key and one of the value |
| `try_emplace(key, args...)`, key absent | the key: one copy (`const K&`) or one move (`K&&`); the value: one construction from `std::forward<Args>(args)...` |
| `operator[](key)`, key absent | the key: one copy or one move; the value: one value-initialisation `V()` |
| any insertion, key present | none (`try_emplace` and `operator[]` leave an rvalue key argument untouched) |
| growth, `rehash`, `reserve` | none |
| copy constructor / copy assignment | one copy construction of each key and value of `other` (assignment destroys the target's old elements) |
| move constructor / move assignment | none (move assignment destroys the target's old elements) |
| `erase`, `clear`, destructor | destroys each removed key and value exactly once |

The signatures, member types, `noexcept` on the default constructor and the move operations, and the const-correctness of the observers are checked at compile time; a mismatch is a compile error that says what is wrong.

**How the tests work**

The test's constructor argument `hashMode` picks the hash function: `0` is the identity (`hash(k) == k`), `1` sends **every** key to bucket `0` (one long chain). A hidden harness has **four slots** (`0`..`3`), each either empty or holding one `HashMap<Key, Val, KeyHash, KeyEq>`. `Key` and `Val` hold an integer `value`; `Key` has no default constructor and no `operator==`, `Val` default-constructs to `0`, both have counted copy and `noexcept` move constructors (a moved-from object has value `-1`), and the harness knows the address of every live `Key` and `Val`. Each test call performs one C++ operation (`Key(k)` below is a local `Key` built by the harness):

| Test call | What the harness does |
|---|---|
| `create(s)` | `slots[s].emplace()` (any `HashMap` already in slot `s` is destroyed first) |
| `insert(s, k, v)` | `const std::pair<const Key, Val> kv(Key(k), Val(v)); slots[s]->insert(kv).second` |
| `tryEmplace(s, k, v)` | `Key key(k); slots[s]->try_emplace(std::move(key), v, Label{}).second` (constructs `Val(int, Label&&)`; `Label{}` is an rvalue that must arrive as one) |
| `subscript(s, k, v, rvalue)` | `Val& r = (*slots[s])[key]` (`[std::move(key)]` if `rvalue`); returns `r.value`, then sets `r.value = v` |
| `at(s, k)` | `std::as_const(*slots[s]).at(Key(k)).value`, or `-1` if it throws `std::out_of_range` |
| `find(s, k)` | `it = slots[s]->find(Key(k))`: `-1` if `it == end()`, else `it->second.value` |
| `contains(s, k)`, `erase(s, k)` | `slots[s]->contains(Key(k))`, `slots[s]->erase(Key(k))` |
| `size(s)`, `bucketCount(s)` | `slots[s]->size()`, `slots[s]->bucket_count()` (also checks `empty()` and `load_factor()`) |
| `bucketOf(s, k)`, `bucketSize(s, b)` | `slots[s]->bucket(Key(k))`, `slots[s]->bucket_size(b)` |
| `rehash(s, n)`, `reserve(s, n)`, `clear(s)` | `slots[s]->rehash(n)`, `slots[s]->reserve(n)`, `slots[s]->clear()` |
| `contents(s)` | every element as `"key=value"`, read by iterating from `begin()` to `end()`, **sorted by key** |
| `copyConstruct(a, b)` | `slots[b].emplace(std::as_const(*slots[a]))` (`a != b`) |
| `copyAssign(a, b)` | `*slots[b] = std::as_const(*slots[a])` (`a` may equal `b`) |
| `moveConstruct(a, b)` | `slots[b].emplace(std::move(*slots[a]))` (`a != b`) |
| `moveAssign(a, b)` | `*slots[b] = std::move(*slots[a])` (`a` may equal `b`) |
| `destroy(s)`, `destroyAll()` | destroy the `HashMap` in slot `s` / in every slot, in slot order |
| `alive()` | the number of `Key` and `Val` objects currently alive (two per element) |
| `copies()`, `moves()` | the number of `Key` and `Val` copies and moves so far in this test |
| `heapBlocks()` | heap blocks allocated by your code and not yet freed |
| `errors()` | problems the harness detected (an element destroyed twice, copied from a dead object, an rvalue not forwarded, an iteration that misses or repeats elements, a block freed twice); `[]` when everything is correct |

A value of `-2` means the element read is not alive. Most tests end with `destroyAll()`, `alive()` and `heapBlocks()` (both expected `0`) and `errors()` (expected `[]`).

**Example** (`hashMode` 0)

```
create(0)
bucketCount(0)          -> 0
insert(0, 1, 10)        -> true     the first insertion creates 8 buckets
insert(0, 1, 11)        -> false    already present: nothing changes
tryEmplace(0, 2, 20)    -> true     the key is moved in, the value built in place
subscript(0, 3, 30, false) -> 0     a new key: the value is default-constructed (0), then set to 30
find(0, 3)              -> 30
at(0, 4)                -> -1       std::out_of_range
copies()                -> 3        insert copied key and value, operator[] copied the key
moves()                 -> 1        try_emplace moved its key
heapBlocks()            -> 4        three nodes and the bucket array
contents(0)             -> ["1=10", "2=20", "3=30"]
```

**Constraints**

- C++23 (GCC). At most `3000` calls per test; keys and values are non-negative integers; a map holds at most a few thousand elements.
