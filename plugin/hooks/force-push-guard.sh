#!/usr/bin/env bash
# force-push-guard.sh — PreToolUse(Bash): block `git push --force`, `-f`, `+refspec`, `--mirror`.
# A plain force-push silently drops remote commits the pusher never pulled. Seen with two
# agents on one branch: one pushed a fix from another worktree while the other's checkout was
# one commit behind, and a force-push from it would have dropped that fix.
# `--force-with-lease --force-if-includes` stays allowed: it refuses when the remote tip isn't
# in your local history. Set `git config --global push.useForceIfIncludes true` to imply it.
# Fail-open: no jq or no command means no check.
cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0

# One simple command per line; quotes and subshell brackets dropped.
# ponytail: word-level scan, not a shell parser. A `git push` hidden inside `bash -c "…"` with
# odd quoting can slip through; this guards against habit, not against a determined agent.
while read -r -a w; do
    [ "${w[0]:-}" = git ] || continue
    push=0 skip=0
    for a in "${w[@]:1}"; do
        if [ $push = 0 ]; then                   # find the subcommand past git's own options
            if [ $skip = 1 ]; then skip=0
            elif [ "$a" = -C ] || [ "$a" = -c ]; then skip=1
            elif [[ $a == -* ]]; then :
            elif [ "$a" = push ]; then push=1
            else break; fi
            continue
        fi
        case $a in
            --force|--mirror|+*) bad=1 ;;
            --*) bad=0 ;;                        # incl. --force-with-lease, --force-if-includes
            -*f*) bad=1 ;;                       # -f, or a cluster like -uf
            *) bad=0 ;;
        esac
        if [ $bad = 1 ]; then
            # JSON deny, not exit 2: Claude Code and Codex both read this shape, so one file serves both.
            jq -cn --arg r "force-push-guard: blocked \`${w[*]}\` ($a). A plain force-push drops remote commits you never pulled (another agent's work). Use: git push --force-with-lease --force-if-includes … (refuses if the remote has commits you don't). Pushing to another agent's branch? Ask first, or open a PR against it." \
                '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
            exit 0
        fi
    done
done < <(tr ';&|()`\n' '\n\n\n\n\n\n\n' <<<"$cmd" | tr -d "\"'")
exit 0
