**Approaches**
- Repeated simulation: scan for adjacent `(+, -)` pairs and resolve until stable — O(n^2).
- Expected: stack of survivors. For each asteroid: if it moves right, push. If it moves left, while the top moves right and is smaller, pop it; then if the top moves right and is equal, pop it and drop the current one; if the top moves right and is larger, drop the current one; otherwise (stack empty or top moves left) push. O(n) time (each asteroid pushed and popped once), O(n) space.

**Common wrong turns**
- Treating `(-, +)` (left-mover then right-mover) as a collision.
- Stopping after one collision: a big left-mover can destroy several right-movers.
- Equal sizes: both must disappear, and the loop must stop.
- Pushing the current asteroid even after it exploded.

**Hint ladder**
1. Which pairs of asteroids can ever meet?
2. When a left-mover arrives, which earlier asteroid does it meet first? And after that one explodes?
3. Keep the survivors on a stack; a new left-mover fights the stack top while the top moves right.

**Follow-ups**
- Return the number of collisions, or the time at which each happens (needs positions and speeds).
- Different speeds per asteroid (now order of collisions matters — event simulation with a priority queue).
- Car Fleet (similar "who catches whom" reasoning with sorting).
