# Pre-Publish Checklist — Spidersan 0.4.0

**Date:** January 26, 2026  
**Target:** npm publish to production

## Phase 3 Status

### ✅ Completed

- [x] **Version bumped** to 0.4.0 in package.json
- [x] **CHANGELOG.md** updated with comprehensive 0.4.0 entry
- [x] **Release notes** created (RELEASE_NOTES_0.4.0.md)
- [x] **Build successful** — `npm run build` passes
- [x] **dist/ verified** — CLI binary + all modules compiled
- [x] **npm pack dry-run** — Verified package contents (dist/, README, LICENSE, CHANGELOG)
- [x] **CLI smoke test** — `spidersan --help` shows core commands
- [x] **publishConfig** — `"access": "public"` set in package.json
- [x] **License** — MIT confirmed, single LICENSE file
- [x] **Documentation** — README, CORE.md, USAGE.md aligned with core narrative

### 🚀 Ready for npm publish

**Command to run:**
```bash
cd /Users/freedbird/Dev/spidersan-public
npm publish
```

**Post-publish verification:**
1. Check https://www.npmjs.com/package/spidersan shows 0.4.0
2. Test fresh install: `npm install -g spidersan@latest`
3. Verify CLI works: `spidersan --help`
4. Verify version: `spidersan --version` shows 0.4.0

### 📋 Final Verification

**Package Contents:**
- ✅ dist/ (compiled TypeScript)
- ✅ README.md
- ✅ LICENSE
- ✅ CHANGELOG.md

**Not Included (correct):**
- ❌ src/ (source TypeScript)
- ❌ tests/
- ❌ node_modules/
- ❌ collab/ (moved to treebird-internal)

**npm Config:**
- ✅ `"access": "public"` (publishConfig)
- ✅ `"version": "0.4.0"`
- ✅ `"main": "dist/index.js"`
- ✅ `"bin": { "spidersan": "./dist/bin/spidersan.js" }`
- ✅ `"files": ["dist", "README.md", "LICENSE", "CHANGELOG.md"]`

**Scripts:**
- ✅ `prepublishOnly`: typecheck + lint + build (runs automatically before publish)
- ✅ `prepare`: build (runs on npm install)

### 🔐 Authentication

**You'll need:**
- npm account credentials
- 2FA code (if enabled)

**Command:**
```bash
npm publish
```

Enter your npm credentials when prompted.

### 📊 Success Criteria

After `npm publish`:
1. ✅ Version 0.4.0 appears on npmjs.com/package/spidersan
2. ✅ Fresh install works: `npm install -g spidersan@latest`
3. ✅ CLI shows 15 core commands
4. ✅ No ecosystem commands visible (unless spidersan-ecosystem installed)
5. ✅ README renders correctly on npm page

---

## Post-Publish Tasks

1. **Tag release in git:**
   ```bash
   git tag -a v0.4.0 -m "Release 0.4.0 - Core focus + plugin architecture"
   git push origin v0.4.0
   ```

2. **GitHub release:**
   - Create release on GitHub
   - Copy RELEASE_NOTES_0.4.0.md content
   - Mark as "Latest Release"

3. **Update README badges (if needed):**
   - npm version badge
   - Download stats

4. **Announce:**
   - Reddit (r/LocalLLaMA, r/ClaudeAI)
   - Twitter/X
   - GitHub Discussions

---

**All systems go. Ready to publish! 🚀**
