const { validateBranchName } = require('./src/lib/security.ts');
try {
  validateBranchName('--some-flag');
  console.log("Allowed");
} catch(e) {
  console.log("Denied", e.message);
}
