## 2024-04-27 - Initial
**Learning:** Initial bolt journal.
**Action:** Keep learning and making codebase fast.

## 2024-04-27 - Conflict Graph Generation Optimization
**Learning:** Generating conflict graphs using nested loops over branches takes O(N^2 * M) time. This is especially slow when N is large. By using an inverted index (mapping files to the branches that modify them), we can convert this to an O(N * M) lookup process, achieving ~45x speedup.
**Action:** Avoid nested loops when looking for intersections across large sets of arrays/files. Map the inner dimension (files) to their containers (branches) first, then iterate sequentially.
