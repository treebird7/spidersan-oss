# Contributing to Spidersan

Thanks for helping. Bug reports, fixes and docs corrections are all welcome.

## Reporting a bug

Open a [GitHub issue](https://github.com/treebird7/spidersan-oss/issues) with:

- the exact commands you ran and what you expected
- what happened instead (paste the output)
- `spidersan --version`, `node --version` and your OS

A minimal repro in a throwaway repo is the fastest route to a fix. `assets/demo.sh` shows
how to build one with an isolated `HOME`, so your own config doesn't leak in.

## Development setup

Requires Node.js 22 or newer.

```bash
git clone https://github.com/<you>/spidersan-oss.git
cd spidersan-oss
npm ci
npm run build
node dist/bin/spidersan.js --help
```

`npm run dev` rebuilds on change.

## Before you open a pull request

```bash
npm run typecheck
npm run lint
npm run build
npm run test:run      # `npm test` starts vitest in watch mode
```

If you touch `mcp-server/`, it is its own package: run `npm ci`, `npm run build` and
`npm run test:run` inside it too (it needs the root `dist/` built first).

- Branch from `main`, and keep a pull request to one change.
- Add a test for behaviour you change. Bugs get a test that failed before the fix.
- Add a line under `## [Unreleased]` in `CHANGELOG.md` for anything a user would notice.
- Shell out with `execFileSync(cmd, [args])`, never a concatenated command string, and
  validate branch names and paths with the helpers in `src/lib/security.ts`.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/) (`fix:`, `feat:`, `docs:`,
`feat!:` for breaking changes), imperative mood, first line under 72 characters.
