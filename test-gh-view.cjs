const { execFileSync } = require('child_process');
try {
  execFileSync('echo', ['gh', 'pr', 'view', '--json', 'title', '--', '123'], { stdio: 'inherit' });
} catch (e) {
  console.log("Failed", e.message);
}
