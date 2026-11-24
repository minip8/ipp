A **ladder** from `beginWord` to `endWord` is a sequence of words `beginWord = w1, w2, ..., wk = endWord` where

- consecutive words differ in **exactly one** position (same length, one letter changed), and
- every word after the first (`w2` to `wk`) appears in `wordList`. `beginWord` itself does not need to be in the list.

Return the number of words in the **shortest** ladder, or `0` if no ladder exists.

**Examples**

```
beginWord = "cold", endWord = "warm",
wordList  = ["cord","card","ward","warm","word","worm","wore"]   ->  5
```

`cold -> cord -> card -> ward -> warm` has 5 words. (`cold -> cord -> word -> worm -> warm` also has 5.)

```
beginWord = "cold", endWord = "warm",
wordList  = ["cord","card","ward","word","worm"]                 ->  0
```

`warm` is not in the list, so no ladder can end there.

```
beginWord = "hit", endWord = "hot", wordList = ["hot"]           ->  2
```

**Constraints**

- `1 <= beginWord.length <= 10`; `endWord` and every list word have the same length as `beginWord`
- `1 <= wordList.length <= 5000`
- all words consist of lowercase English letters
- words in `wordList` are distinct
- `beginWord != endWord`
