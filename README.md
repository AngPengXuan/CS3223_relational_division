# Relational Division Visualiser

An interactive visualiser for computing the relational division `r(T, S) ÷ s(S)`:
the T values that appear in r together with **every** S value in s. It runs
the sort-based and hash-based algorithms from CS3223 on your own data. Each
run is recorded on a scrubbable timeline that shows every page read, every tuple
held in memory, and every match or miss.

Companion to the
[B+ tree visualiser](https://github.com/AngPengXuan/CS3223_B-Tree_Visualiser) and the
[hash index visualiser](https://github.com/AngPengXuan/CS3223_Hash_Index_Visualiser),
and it uses the same timeline controls.

## The algorithms

### Sort-based

1. Sort s on S, and sort r on (T, S).
2. **Scan and group**: read r until the T value changes, which collects one T group.
3. **Merge and verify**: scan s alongside the group, as in a merge join. Both
   sides are in ascending order, so when the group's cursor moves past an s value
   without matching it, that value cannot appear later in the group.
4. **Output** T if every s value matched, then move on to the next T group.

Excluding the sorts, r is read exactly once and s is read once per group, so
the cost is at most `|r| + N × |s|` for N distinct T values. The visualiser
counts reads exactly. If a group fails, the algorithm stops reading s early,
and the final frame shows how many reads that saved compared with the bound.

### Hash-based

This version assumes all of r's tuples for any one T value fit in memory.

1. **Partition** r on T, so each T group lands in exactly one partition.
2. **Build**: for each partition, build a hash table on (T, S) and collect the
   distinct T values.
3. **Probe**: for each distinct value VT, probe `(VT, s)` for every s. A miss
   discards VT, and when every probe hits, VT is output.

s is read into memory once and reused for every probe.

### Hash-based (general case)

This version handles the case where a single T group might not fit in memory.

1. Partition **both** r and s on S with the same hash function.
2. Run the standard hash algorithm on each pair (rᵢ, sᵢ), giving Qᵢ.
3. The answer is `Q₀ ∩ Q₁ ∩ …`.

Two edge cases are shown explicitly. When sᵢ is empty, that pair imposes no
constraint, so it is skipped rather than intersected. When rᵢ is empty but sᵢ
is not, Qᵢ = ∅, so the whole answer is empty. As soon as the running
intersection is empty, the remaining pairs are skipped.

## Conventions

| | |
|---|---|
| Input | r is entered as `T S` pairs (`Alice CS2040, Alice CS1010`) and s as a list (`CS2040, CS1010`). Duplicate tuples are dropped, since relations are sets. |
| Ordering | Integers compare numerically. Other values compare by character code. |
| Hashing | Integers hash to themselves (`h(v) = v`), so numeric data can be checked by hand. Other values use 32-bit FNV-1a. |
| In-memory hash table | 4 buckets on the composite key (T, S) |
| Cost | Page reads and writes. A partition's output page is written when it fills, and partly filled pages are written in a final flush. |
| Empty s | `r ÷ s = π_T(r)` (vacuous truth), with no algorithm run |

## Running it

```bash
npm install
npm run dev
```

`npm run build` type-checks the code and produces `dist/`. Pushing to `main`
deploys the app to GitHub Pages via `.github/workflows/deploy.yml`.

## Layout

| File | |
|---|---|
| `src/relation.ts` | Shared vocabulary: pages, ordering, hashing, the snapshot model, and the `Recorder` |
| `src/sortDivision.ts` | Sort-based division, instrumented |
| `src/hashDivision.ts` | Hash-based division, both the standard and the general case |
| `src/history.ts` | Input parsing and timeline navigation |
| `src/components/DivisionVisualizer.tsx` | Disk, memory and output panes |
| `src/components/HistoryTimeline.tsx` | Transport controls, slider, and the explanation for each frame |

Each algorithm mutates a `Recorder`'s disk, memory, output and I/O counters and
calls `emit` at each interesting moment. `emit` deep-copies that state into a
frame, so the timeline can show any intermediate step without the algorithms
knowing anything about React.
