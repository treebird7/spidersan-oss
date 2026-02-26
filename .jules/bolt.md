## 2025-05-20 - Validation vs Sanitization
**Learning:** `sanitizeFilePaths` filters out invalid paths but does NOT throw errors, while `validateFilePath` throws on invalid paths.
**Action:** When a security check must fail the entire operation on *any* invalid input (e.g., `register` command), use `validateFilePath` in a loop. Do not rely on `sanitizeFilePaths` if strict validation is required by tests.

## 2025-05-20 - Supabase Push Optimization
**Learning:** Sequential HTTP requests in loops (N+1 problem) are a major bottleneck for branch synchronization. Using Supabase's `in` filter (`branch_name=in.(...)`) allows fetching all relevant records in a single request.
**Action:** Always look for batching opportunities when interacting with remote storage. For Supabase, use `in` filters for reads and bulk inserts/parallel updates for writes. Verify optimizations with mocked network tests to ensure request counts are reduced.
