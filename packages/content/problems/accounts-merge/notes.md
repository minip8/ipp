**Approaches**
- Graph + DFS: nodes are emails; connect the first email of each account to each of its other emails. Each connected component is one person; the name comes from any account in it. Sort each component. O(E log E) where E is the total number of emails (sorting dominates).
- Union-find over account indices: map each email to the first account index that contained it; when an email is seen again, union the two accounts. Then group emails by root account. Same complexity, arguably cleaner.
- Brute force: repeatedly merge any two accounts that share an email until nothing changes — O(n^2 · L) per pass and up to n passes. Recognise it, then move on.

**Common wrong turns**
- Merging accounts by name. Two different people can both be "Ana".
- Only merging pairwise and not transitively (A–B and B–C share different emails; A and C must still merge).
- Forgetting to deduplicate emails, or including the name in the sorted list.
- Sorting the name together with the emails.
- Using union-find on accounts but grouping emails by the account index rather than by its root.

**Hint ladder**
1. What does "belongs to the same person" look like if you draw accounts or emails as dots and shared emails as lines?
2. You need connected components of that graph. Which two techniques find those?
3. With union-find on account indices: keep a map from email to the first account that owned it; a repeat sighting means "union these two accounts".
4. After all unions, bucket every email under the root of its account, dedupe and sort, and prefix with the name of that root account.

**Follow-ups**
- Accounts stream in one at a time and you must answer "which person owns email X?" online.
- Very large input that doesn't fit in memory (external sort / map-reduce of edges, then connected components).
- Should name mismatches between linked accounts be treated as data errors? How would you report them?
