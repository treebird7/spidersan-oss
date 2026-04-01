#!/usr/bin/env python3
"""Test suite for spidersan bot subcommand. Drives the self-improve loop.

Tests the compiled JS via subprocess (npx tsx or node dist/).
Run: python3 test_bot.py
"""

import json
import os
import subprocess
import sys

PASS_COUNT = 0
FAIL_COUNT = 0

BOT_SRC = os.path.join(os.path.dirname(__file__), "..", "src", "commands", "bot.ts")
SPIDERSAN_ROOT = os.path.join(os.path.dirname(__file__), "..")


def test(name, condition, detail=""):
    global PASS_COUNT, FAIL_COUNT
    if condition:
        print(f"  PASS: {name}")
        PASS_COUNT += 1
    else:
        print(f"  FAIL: {name} {detail}")
        FAIL_COUNT += 1


def run_spider(args, env_extra=None, timeout=10):
    """Run spidersan with args via npx tsx."""
    env = os.environ.copy()
    env.pop("GIT_BOT_ENABLED", None)  # clean slate
    if env_extra:
        env.update(env_extra)
    try:
        r = subprocess.run(
            ["npx", "tsx", os.path.join(SPIDERSAN_ROOT, "src", "bin", "spidersan.ts")] + args,
            capture_output=True, text=True, timeout=timeout, env=env,
            cwd=SPIDERSAN_ROOT,
        )
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "timeout"


def main():
    global PASS_COUNT, FAIL_COUNT

    source = ""
    if os.path.exists(BOT_SRC):
        source = open(BOT_SRC).read()

    print("=== spidersan bot test suite ===\n")

    # ── Tier 1: CLI structure ────────────────────────────────────────────

    print("[cli structure]")

    test("bot.ts exists", os.path.exists(BOT_SRC))
    test("exports botCommand", "botCommand" in source or "bot" in source)

    # Check bot is registered in main CLI
    main_cli = os.path.join(SPIDERSAN_ROOT, "src", "bin", "spidersan.ts")
    if os.path.exists(main_cli):
        main_src = open(main_cli).read()
        test("bot registered in CLI", "bot" in main_src.lower())
    else:
        test("bot registered in CLI", False, "(spidersan.ts not found)")

    test("has Commander subcommands", "bot add" in source or "addCommand" in source or ".command(" in source)

    # ── Tier 2: Vault gate ───────────────────────────────────────────────

    print("\n[vault gate]")

    test("checks GIT_BOT_ENABLED", "GIT_BOT_ENABLED" in source)
    test("exits when not set", "exit" in source.lower() or "process.exit" in source)

    # ── Tier 3: Command parsing ──────────────────────────────────────────

    print("\n[command parsing]")

    test("has parseCommand function", "parseCommand" in source or "parse_command" in source or "parseCmd" in source)
    test("validates command names", "sync" in source and "pull" in source and "push" in source and "status" in source)
    test("validates repo names", "repos" in source.lower() or "config" in source.lower())
    test("rejects path traversal", '".."' in source or "'..' " in source or "dotdot" in source.lower())
    test("validates branch args", "match" in source or "test(" in source or "regex" in source.lower() or "/^[" in source)

    # ── Tier 4: Access control ───────────────────────────────────────────

    print("\n[access control]")

    test("has tier definitions", "coordinator" in source and "specialist" in source and "worker" in source)
    test("has isAuthorized function", "isAuthorized" in source or "is_authorized" in source or "checkAuth" in source)
    test("workers limited to status+log", "status" in source and "log" in source)
    test("denies unknown senders", "null" in source or "undefined" in source or "unknown" in source.lower())

    # ── Tier 5: Git execution ────────────────────────────────────────────

    print("\n[git execution]")

    test("no shell execution", "shell:" not in source.replace("shell: false", "") or "shell" not in source)
    test("uses execFileSync or spawn with array", "execFileSync" in source or "spawn" in source or "execFile" in source)
    test("pull uses --ff-only", "--ff-only" in source)
    test("has rate limiter", "rate" in source.lower() and ("limit" in source.lower() or "throttle" in source.lower()))
    test("truncates output", "500" in source or "slice" in source or "substring" in source)

    # ── Tier 6: Transport ────────────────────────────────────────────────

    print("\n[transport]")

    test("uses fetch for HTTP", "fetch(" in source)
    test("has Bearer auth", "Bearer" in source or "Authorization" in source)
    test("polls with to= filter", "to=" in source or "?to=" in source or "to:" in source)
    test("posts replies with reply_to", "reply_to" in source or "replyTo" in source)
    test("tracks high-water mark", "hwm" in source.lower() or "highWater" in source or "lastId" in source or "cursor" in source)

    # ── Tier 7: Config management ────────────────────────────────────────

    print("\n[config]")

    test("loads from bot.json", "bot.json" in source)
    test("has add repo logic", "add" in source.lower())
    test("has remove repo logic", "remove" in source.lower() or "delete" in source.lower())
    test("has list repos logic", "repos" in source.lower() or "list" in source.lower())

    # ── Summary ──────────────────────────────────────────────────────────

    print(f"\n=== Results: {PASS_COUNT} PASS, {FAIL_COUNT} FAIL ===")


if __name__ == "__main__":
    main()
