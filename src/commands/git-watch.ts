/**
 * spidersan git-watch
 *
 * Starts a git-change notification daemon that subscribes to spidersan_git_events
 * via Supabase Realtime and catches up on missed events via polling.
 *
 * Usage:
 *   spidersan git-watch                    # daemon mode (runs until Ctrl+C)
 *   spidersan git-watch --once             # catch-up only, then exit
 *   spidersan git-watch --repos ~/Dev/Envoak:~/Dev/Toak
 *   spidersan git-watch --interval 30000   # poll every 30s
 *   spidersan git-watch --json             # machine-readable log output
 *
 * Notifications:
 *   push events   → warns agent to run `spidersan pulse`
 *   branch delete → marks registry entry abandoned, archives it
 *   PR/create     → logged to activity.jsonl
 *
 * Pending events are written to ~/.spidersan/git-events-pending.jsonl for
 * future AI-layer (spidersan-smol) processing (P2).
 */

import { Command } from 'commander';
import { startGitWatch, catchUpOnce } from '../lib/git-events-subscriber.js';

export const gitWatchCommand = new Command('git-watch')
    .description('Subscribe to git-change notifications from GitHub webhooks')
    .option('--once', 'Catch up on missed events then exit (useful for cron)')
    .option('--interval <ms>', 'Polling interval in ms for catch-up (default: 60000)', '60000')
    .option('--repos <paths>', 'Colon-separated local repo paths to watch (default: auto-detect from ~/Dev)')
    .option('--json', 'Machine-readable log output')
    .option('--no-realtime', 'Disable WebSocket subscription (polling only)')
    .option('--quiet', 'Suppress output')
    .action(async (options) => {
        const pollIntervalMs = parseInt(options.interval, 10);
        const repoPaths = options.repos
            ? options.repos.split(':').map((p: string) => p.trim()).filter(Boolean)
            : [];

        const logger = options.quiet
            ? undefined
            : options.json
                ? (msg: string) => console.log(JSON.stringify({ ts: new Date().toISOString(), msg }))
                : (msg: string) => console.log(`[git-watch] ${msg}`);

        try {
            if (options.once) {
                await catchUpOnce({ repoPaths, logger, quiet: options.quiet });
                if (!options.quiet) console.log('[git-watch] catch-up complete');
                process.exit(0);
            }

            const handle = await startGitWatch({
                pollIntervalMs,
                repoPaths,
                logger,
                quiet: options.quiet,
                disableRealtime: options.realtime === false,
            });

            if (!options.quiet) {
                console.log('[git-watch] daemon running — Ctrl+C to stop');
                console.log('[git-watch] pending events: ~/.spidersan/git-events-pending.jsonl');
            }

            // Graceful shutdown
            const shutdown = () => {
                if (!options.quiet) console.log('\n[git-watch] stopping');
                handle.stop();
                process.exit(0);
            };
            process.on('SIGINT', shutdown);
            process.on('SIGTERM', shutdown);

        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (options.json) {
                console.error(JSON.stringify({ error: msg }));
            } else {
                console.error(`[git-watch] error: ${msg}`);
                if (msg.includes('SUPABASE_URL')) {
                    console.error('  Set SUPABASE_URL and SUPABASE_KEY (or COLONY_SESSION_JWT) env vars');
                }
            }
            process.exit(1);
        }
    });
