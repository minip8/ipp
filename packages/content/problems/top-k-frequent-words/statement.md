Given a list of `words` and an integer `k`, return the `k` most frequent distinct words.

The result must be ordered by frequency, **highest first**. Words with the same frequency are ordered **alphabetically** (plain lexicographic comparison of lowercase strings, so `"app"` comes before `"apple"`). This ordering also decides which words make the cut when several share the frequency at the boundary.

**Examples**

```
words = ["go", "run", "go", "jump", "run", "go", "fly"], k = 2   ->   ["go", "run"]
```
`go` appears 3 times, `run` twice.

```
words = ["b", "a", "c", "b", "a", "c", "d"], k = 2   ->   ["a", "b"]
```
`a`, `b` and `c` all appear twice; alphabetical order picks `a` and `b`.

**Constraints**

- `1 <= words.length <= 5 * 10^4`
- `1 <= words[i].length <= 10`, lowercase English letters only
- `1 <= k <=` the number of distinct words
