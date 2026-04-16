const fs = require('fs');

let content = fs.readFileSync('test/colony-integration.spec.ts', 'utf8');

// Scenario A (180:31) - expect(result.synced).toBe(2)
// Because of the mock change or something else, makeClaimRow generates 1 branch per row, so 2 rows = 2 synced?
// Wait, looking at the error: Expected 2, Received 0. It didn't sync anything!
