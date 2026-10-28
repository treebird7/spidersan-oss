#!/usr/bin/env bash
# Self-check for pr-conflicts: a local origin with refs/pull/*/head and a gh stub.
#   PR1, PR2: same line of a.txt   -> checking 1: PR2 gains a conflict (exit 1)
#   PR3: stale, conflicts with main on b.txt, never touches a.txt -> "already conflicts", not blamed
#   PR4: c.txt only                -> unaffected
#   checking 4: everyone unaffected (exit 0); checking 3: base conflict (exit 1, PR half skipped)
#   PR5 (only when BAD=1): unrelated history, so merge-tree itself errors -> exit 2, never "clean"
#   MANY=1: 201 open PRs -> exit 2, never a partial check
set -euo pipefail
script=$(cd "$(dirname "$0")" && pwd)/pr-conflicts
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
git init -q -b main "$t/w"; cd "$t/w"
g() { git -c user.name=t -c user.email=t@t "$@"; }
printf 'a1\na2\n' > a.txt; printf 'b1\n' > b.txt; g add .; g commit -qm base
g switch -qc p3; printf 'b-pr3\n' > b.txt; g commit -qam p3            # branches before main moves
g switch -q main; printf 'b-main\n' > b.txt; g commit -qam main-moves
g switch -qc p1; printf 'a-pr1\na2\n' > a.txt; g commit -qam p1
g switch -q main; g switch -qc p2; printf 'a-pr2\na2\n' > a.txt; g commit -qam p2
g switch -q main; g switch -qc p4; echo c > c.txt; g add c.txt; g commit -qm p4
g switch -q --orphan p5; echo z > z.txt; g add z.txt; g commit -qm p5
git init -q --bare "$t/o.git"; git remote add origin "$t/o.git"
git push -q origin main p1:refs/pull/1/head p2:refs/pull/2/head p3:refs/pull/3/head \
    p4:refs/pull/4/head p5:refs/pull/5/head

mkdir "$t/bin"; cat > "$t/bin/gh" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
  "pr view") [ -n "${GHFAIL:-}" ] && { echo "gh: not logged in" >&2; exit 1; }; echo '{"baseRefName":"main"}' ;;
  "pr list") if [ -n "${MANY:-}" ]; then ids=$(seq 1 201); else ids="1 2 3 4 ${BAD:+5}"; fi
             printf '%s\n' $ids | jq -s 'map({number: ., baseRefName: "main"})' ;;
esac
EOF
chmod +x "$t/bin/gh"; export PATH="$t/bin:$PATH"

run() { "$script" "$1" > "$t/out" 2>&1 && rc=0 || rc=$?; cat "$t/out"; echo "exit=$rc"; }
fail() { echo "FAIL: $*"; exit 1; }
leftover() { git for-each-ref refs/pr-conflicts | wc -l | tr -d ' '; }

run 1
[ "$rc" = 1 ] || fail "PR1 should exit 1"
grep -q 'PR #2 would conflict after #1 lands' "$t/out" || fail "PR2 not flagged"
grep -A1 'PR #2 would' "$t/out" | grep -q 'a.txt' || fail "PR2 conflict should be a.txt"
grep -q 'PR #3 unaffected (already conflicts' "$t/out" || fail "stale PR3 blamed on PR1"
grep -q 'PR #4 unaffected$' "$t/out" || fail "PR4 should be unaffected"
run 4
[ "$rc" = 0 ] || fail "PR4 should exit 0"
run 3
[ "$rc" = 1 ] && grep -q 'conflicts vs main (rebase first' "$t/out" || fail "PR3 base conflict"
grep -A1 'rebase first' "$t/out" | grep -q 'b.txt' || fail "PR3 conflict should be b.txt"

# prsan skills#125 P1: a merge-tree error must be an error, not a clean or conflict result.
BAD=1 run 4
[ "$rc" = 2 ] || fail "merge-tree error vs another PR should exit 2, got $rc"
grep -q 'PR #5 unaffected' "$t/out" && fail "errored PR5 reported unaffected"
BAD=1 run 5
[ "$rc" = 2 ] || fail "merge-tree error vs base should exit 2, got $rc"
grep -q 'rebase first' "$t/out" && fail "base merge error reported as a conflict"

MANY=1 run 4
[ "$rc" = 2 ] && grep -q 'more than 200 open PRs' "$t/out" || fail "201 PRs should refuse, got $rc"

# A concurrent run in the same clone owns refs/pr-conflicts/<its pid>/…; ours must not delete them.
git update-ref refs/pr-conflicts/99999/base main
run 4 > /dev/null
git rev-parse -q --verify refs/pr-conflicts/99999/base > /dev/null || fail "deleted another run's refs"
git update-ref -d refs/pr-conflicts/99999/base
[ "$(leftover)" = 0 ] || fail "refs left behind: $(leftover)"
# prsan skills#125 re-review P2: setup failures are exit 2, never gh's raw 1 (which means "conflicts").
GHFAIL=1 run 4
[ "$rc" = 2 ] || fail "gh failure should exit 2, got $rc"
run 9      # no refs/pull/9/head on origin: the fetch fails
[ "$rc" = 2 ] || fail "fetch failure should exit 2, got $rc"
echo "ALL PASS"
