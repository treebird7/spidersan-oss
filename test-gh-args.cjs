const { execFileSync } = require('child_process');
try {
  execFileSync('echo', ['gh', 'api', 'repos/-o/test/branches'], { stdio: 'inherit' });
} catch (e) {
  console.log("Failed", e.message);
}
