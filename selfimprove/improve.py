#!/usr/bin/env python3
"""Self-improve loop for spidersan bot.ts.

Uses llama to iteratively implement the git executor stubs in bot.ts.
Each iteration: propose change → run tests → keep/revert.

Usage:
    python3 selfimprove/improve.py [max_iterations]
"""

import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import urllib.error
import json

LLAMA_URL = os.environ.get("LLAMA_URL", "http://localhost:8081")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(SCRIPT_DIR, "..")
SOURCE = os.path.join(ROOT, "src", "commands", "bot.ts")
BACKUP = SOURCE + ".bak"
RESULTS = os.path.join(SCRIPT_DIR, "improve_results.tsv")
MAX_ITER = int(sys.argv[1]) if len(sys.argv) > 1 else 10


def run_tests() -> tuple[int, int, str]:
    result = subprocess.run(
        [sys.executable, os.path.join(SCRIPT_DIR, "test_bot.py")],
        capture_output=True, text=True, timeout=30, cwd=ROOT,
    )
    output = result.stdout + result.stderr
    passed = output.count("PASS")
    failed = output.count("FAIL")
    return passed, passed + failed, output


def extract_executor_section(source: str) -> str:
    """Extract just the git executor functions from bot.ts."""
    lines = source.splitlines()
    start, end = None, None
    for i, l in enumerate(lines):
        if "Git executor" in l and start is None:
            start = i
        if start and i > start and l.startswith("// ──") and "executor" not in l.lower():
            end = i
            break
    if start is not None:
        return "\n".join(lines[start : end or start + 40])
    return source[:800]


def splice_function(source: str, fn_name: str, new_fn: str) -> str:
    """Replace a specific function in source with new_fn."""
    # Match: function <name>(...): string { ... }
    pattern = re.compile(
        rf"(function {re.escape(fn_name)}\([^)]*\)[^{{]*\{{)[^}}]*(}})",
        re.DOTALL
    )
    m = pattern.search(source)
    if m:
        return source[: m.start()] + new_fn + source[m.end() :]
    return source


def llama_propose(source: str, test_output: str, iteration: int) -> str | None:
    failing = [l.strip() for l in test_output.splitlines() if "FAIL:" in l]

    # Send only the executor section — ~50 tokens vs ~3000 for full file
    executor_section = extract_executor_section(source)

    prompt = f"""Fix this TypeScript function so that it uses --ff-only when calling git pull.

Failing test: {failing[0] if failing else 'pull uses --ff-only'}

Current executors section:
```typescript
{executor_section}
```

Output ONLY the fixed executePull function body (the complete function, nothing else):
"""

    payload = json.dumps({
        "model": "default",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 300,
        "temperature": 0.2,
        "stream": False,
    }).encode()

    req = urllib.request.Request(
        f"{LLAMA_URL}/v1/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            data = json.loads(resp.read())
        return data["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"  [llama error] {e}")
        return None


def extract_code(response: str) -> str:
    # Strip markdown fences if present
    m = re.search(r"```(?:typescript|ts)?\n([\s\S]+?)```", response)
    if m:
        return m.group(1)
    return response.strip()


def main():
    passed, total, output = run_tests()
    print(f"Starting: {passed}/{total} passing")

    if passed == total:
        print("All tests pass — nothing to do.")
        return

    os.makedirs(os.path.dirname(RESULTS), exist_ok=True) if os.path.dirname(RESULTS) else None

    best = passed
    for i in range(1, MAX_ITER + 1):
        print(f"\n=== Iteration {i}/{MAX_ITER} ===")

        with open(SOURCE, "r") as f:
            current = f.read()
        shutil.copy(SOURCE, BACKUP)

        proposal_raw = llama_propose(current, output, i)
        if not proposal_raw:
            print("  No proposal — skipping")
            continue

        proposal = extract_code(proposal_raw)
        if len(proposal) < 20:
            print("  Proposal too short — skipping")
            continue

        print(f"  Proposal:\n{proposal[:300]}")

        # Splice the fixed function into the source (don't replace whole file)
        if "executePull" in proposal:
            new_source = splice_function(current, "executePull", proposal)
        else:
            new_source = current  # fallback: no change

        with open(SOURCE, "w") as f:
            f.write(new_source)

        new_passed, new_total, new_output = run_tests()
        print(f"  Result: {new_passed}/{new_total} (was {passed}/{total})")

        # Write results
        with open(RESULTS, "a") as f:
            f.write(f"{i}\t{new_passed}\t{new_total}\t{time.strftime('%H:%M:%S')}\n")

        if new_passed >= passed:
            passed, total, output = new_passed, new_total, new_output
            best = max(best, passed)
            print(f"  KEPT (best={best}/{total})")
            if passed == total:
                print("\nAll tests pass!")
                break
        else:
            shutil.copy(BACKUP, SOURCE)
            print("  REVERTED (regression)")

        time.sleep(2)

    print(f"\nDone. Best: {best}/{total}")


if __name__ == "__main__":
    main()
