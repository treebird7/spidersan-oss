const { execFileSync } = require('child_process');
try {
  execFileSync('echo', ['--something'], { stdio: 'inherit' });
} catch (e) {
  console.log("Failed", e.message);
}
