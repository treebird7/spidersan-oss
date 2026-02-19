# TEST_RUNNER: spidersan-github-dashboard

## Test Strategy

Run all feature tests in dependency order. A feature's tests must pass before dependent features are tested.

## Execution Order

```bash
# F1: Registry sync (no dependencies)
npx vitest run tests/registry-sync.test.ts

# F2: GitHub inventory (depends on F1)
npx vitest run tests/github-inventory.test.ts

# F3: Cross-machine conflicts (depends on F1, F2)
npx vitest run tests/cross-machine-conflicts.test.ts

# F4: Sync advisor (depends on F2)
npx vitest run tests/sync-advisor.test.ts

# F5: Dashboard TUI (depends on F3, F4)
npx vitest run tests/dashboard-tui.test.ts

# F6: Dashboard web (depends on F3, F4)
npx vitest run tests/dashboard-web.test.ts

# All at once
npx vitest run tests/registry-sync tests/github-inventory tests/cross-machine-conflicts tests/sync-advisor tests/dashboard-tui tests/dashboard-web
```

## Test Gates

| Feature | Test File | Status |
|---------|-----------|--------|
| F1 | tests/registry-sync.test.ts | ⬜ Not written |
| F2 | tests/github-inventory.test.ts | ⬜ Not written |
| F3 | tests/cross-machine-conflicts.test.ts | ⬜ Not written |
| F4 | tests/sync-advisor.test.ts | ⬜ Not written |
| F5 | tests/dashboard-tui.test.ts | ⬜ Not written |
| F6 | tests/dashboard-web.test.ts | ⬜ Not written |

## All Passed

**false**
