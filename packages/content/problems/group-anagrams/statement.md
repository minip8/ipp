Group the strings in `words` so that two strings are in the same group **if and only if** they are anagrams of each other (one can be rearranged into the other, using every letter exactly once).

Return the list of groups. The order of the groups, and the order of the strings inside each group, do not matter. If the same string appears more than once in the input, each occurrence appears in the output.

**Examples**

```
words = ["listen", "stone", "silent", "notes", "pots", "enlist"]
   ->   [["listen", "silent", "enlist"], ["stone", "notes"], ["pots"]]

words = ["", "b", ""]          ->   [["", ""], ["b"]]
words = ["abc"]                ->   [["abc"]]
```

**Constraints**

- `1 <= words.length <= 10^4`
- `0 <= words[i].length <= 100`
- Words contain only lowercase English letters.
