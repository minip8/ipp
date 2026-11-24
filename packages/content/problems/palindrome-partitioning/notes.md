**Approaches**
- Backtracking on the cut position: `go(start)` tries every end ≥ start; if s[start..end] is a palindrome, push it and recurse on end + 1; record the path when start == n. Checking each piece directly costs O(n), so the total is O(n · 2^n) (there are at most 2^(n−1) partitions, each of length ≤ n).
- Improvement: precompute `pal[i][j]` with an O(n^2) DP (`pal[i][j] = s[i]==s[j] && (j - i < 2 || pal[i+1][j-1])`), making each check O(1). The output size still dominates, but this is the answer interviewers like to see.
- Memoised alternative: `parts(i)` = list of partitions of s[i:], built from palindromic prefixes; same output, more memory.

**Common wrong turns**
- Sorting pieces or deduplicating with sets — the pieces' order matters.
- Off-by-one in the slice (`s[start:end]` vs `s[start:end+1]`) so single-character pieces are skipped or the last character is dropped.
- Forgetting that every single character is a palindrome, so there is always at least one partition.
- Recomputing the palindrome check from scratch in the inner loop without noticing the cost — ask them to quantify it.

**Hint ladder**
1. What is the first piece of a partition? What constraints must it satisfy?
2. Once the first piece is fixed, what is left is the same problem on a suffix.
3. Recurse on the start index: for each end, if s[start..end] is a palindrome, take it and recurse on the rest; record when you reach the end of the string.
4. Can you avoid re-checking the same substring for palindromicity many times? (precompute a table)

**Follow-ups**
- Minimum number of cuts so that every piece is a palindrome (Palindrome Partitioning II — O(n^2) DP; the enumerative approach does not scale).
- Count partitions without listing them.
- How large can the output get? (all-equal string: 2^(n−1) partitions.)
