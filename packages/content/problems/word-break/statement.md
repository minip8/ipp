Given a string `s` and a list of dictionary words `wordDict`, return `true` if `s` can be cut into one or more pieces such that **every piece is a word from the dictionary**, and `false` otherwise.

The same dictionary word may be used any number of times. The pieces must cover all of `s`, in order, without overlapping.

**Examples**

```
s = "icecreamcone",  wordDict = ["ice", "cream", "icecream", "cone"]   ->  true    ("ice cream cone")
s = "catsandog",     wordDict = ["cats", "dog", "sand", "and", "cat"]   ->  false
s = "abab",          wordDict = ["ab"]                                  ->  true    ("ab ab")
```

**Constraints**

- `1 <= s.length <= 1000`
- `1 <= wordDict.length <= 1000`
- `1 <= wordDict[i].length <= 20`
- `s` and every word consist of lowercase English letters; the words in `wordDict` are distinct.
