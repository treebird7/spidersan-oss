import fs from 'fs';
const file = 'test/colony-integration.spec.ts';
let content = fs.readFileSync(file, 'utf8');

// The test fails because we changed how overlapping files are computed in src/lib/colony-subscriber.ts
// Oh wait, did we change src/lib/colony-subscriber.ts? Let's check.
