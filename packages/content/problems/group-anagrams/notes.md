**Approaches**
- Brute force: compare every pair with an anagram check, union into groups. O(n^2 * k). Too slow at 10^4 words.
- Expected: hash map from a canonical key to the list of words.
  - Key = sorted letters: O(n * k log k).
  - Key = 26-letter count tuple / encoded string: O(n * k). Discuss how to turn counts into a hashable key (tuple in Python; a string like `"1#0#2#..."` or `std::array<int,26>` with a custom hash in C++).
- Prime-product hashing: cute, but overflows for long words — good to ask why it's risky.

**Common wrong turns**
- Using the letter *set* rather than multiset as the key (`"aab"` vs `"abb"`).
- Count key built by concatenating digits without separators (`[1, 11]` vs `[11, 1]` collide).
- Dropping duplicate words or the empty string.
- In C++, sorting a copy is fine; using `map<string, vector<string>>` is fine but O(log n) per insert — ask about `unordered_map`.

**Hint ladder**
1. What property do all words in one group share that words in other groups don't?
2. Can you compute a single value from a word that is identical for all its anagrams?
3. Use that value as a dictionary key and bucket the words.

**Follow-ups**
- Sorting key vs counting key: which wins when words are long? When the alphabet is Unicode?
- Streaming input too large for memory (external hashing / partition by key).
- Return only groups of size >= 2, or the largest group.
