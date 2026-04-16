// Look at test mock
// The test injects claimRows when URL includes 'type=eq.work_claim' or 'status=eq.in-progress'
// So in-progress fetch returns the claimRow.
// The code loops through in-progress rows, adds 'feature/to-be-released' to colonyBranches Set,
// then upserts the registry.
// Because it's in colonyBranches Set, the sweep phase ignores it:
// if (localBranch.status === 'active' && !colonyBranches.has(localBranch.name) && isColonySourced)
// Wait! If it's a release, should it be in in-progress rows?
// The mockFetch returns `claimRows` when url.includes('status=eq.in-progress')
// But wait, if it's a release scenario, shouldn't the fetch return the release row, NOT the claim row for status=eq.in-progress?
// Wait, `fetchColonySignals` is only called ONCE for `status=eq.in-progress` !!
// Look at `src/lib/colony-subscriber.ts`!
// It doesn't fetch `status=eq.completed`!
// It ONLY fetches `status=eq.in-progress`.
// And any branch NOT in the `inProgressRows` is considered stale/released and is SWEEPED (unregistered).
// So, for Scenario C, `mockFetch` should return EMPTY for `status=eq.in-progress`!
