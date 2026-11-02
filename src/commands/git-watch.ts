/**
 * spidersan git-watch — RETIRED.
 *
 * It subscribed to a hosted git-event table (Realtime plus REST catch-up). That
 * table is being dropped, and the pluggable sync client has no git-event read
 * API, so there is nothing for it to watch. The command stays registered so a
 * cron job or launch agent that still calls it gets a clear refusal and a
 * non-zero exit instead of "unknown command" or a silent no-op.
 *
 * Replacement: pushed branches register themselves server-side, and `conflicts`
 * / `registry-sync --pull` read them through the configured storage.syncModule.
 */

import { Command } from 'commander';

export const GIT_WATCH_RETIRED_MESSAGE = [
    '❌ spidersan git-watch was retired: the hosted git-event feed it read is gone.',
    '   Use pushed-branch sync instead: configure storage.syncModule in ~/.spidersanrc',
    '   (or SPIDERSAN_SYNC_MODULE), then run `spidersan conflicts` or `spidersan registry-sync --pull`.',
    '   For local file watching: spidersan watch',
];

export const gitWatchCommand = new Command('git-watch')
    .description('Retired: use pushed-branch sync via storage.syncModule')
    // Old invocations (`git-watch --once`, `--interval 30000`, ...) must reach the
    // refusal, not die on commander's "unknown option".
    .allowUnknownOption()
    .allowExcessArguments()
    .action(() => {
        for (const line of GIT_WATCH_RETIRED_MESSAGE) console.error(line);
        process.exit(1);
    });
