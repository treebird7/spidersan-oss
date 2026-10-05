/**
 * Ecosystem environment resolution.
 *
 * Two unrelated things are both called "ecosystem" in spidersan:
 *
 *   1. The optional `spidersan-ecosystem` plugin (extra commands). It can be
 *      switched off by `SPIDERSAN_ECOSYSTEM=0|false|no|off`, by
 *      `SPIDERSAN_CORE_ONLY=1|true|yes|on`, or by `ecosystem.enabled: false`
 *      in a config file.
 *   2. The repo list scanned by `spidersan conflicts --ecosystem`. It comes from
 *      `--repos`, then `SPIDERSAN_ECOSYSTEM` when that holds a path list
 *      (colon-separated), then `conflicts.ecosystemRepos` in a config file.
 *      There is no built-in default: unconfigured means no repos.
 *
 * A boolean-looking SPIDERSAN_ECOSYSTEM value is a plugin switch, never a path
 * list — so `SPIDERSAN_ECOSYSTEM=0` no longer scans a repo literally named "0".
 */

import { homedir } from 'os';
import { join } from 'path';
import type { SpidersanConfig } from './config.js';

type Env = Record<string, string | undefined>;

const OFF_TOKENS = ['0', 'false', 'no', 'off'];
const ON_TOKENS = ['1', 'true', 'yes', 'on'];

function norm(value?: string): string {
    return (value ?? '').trim().toLowerCase();
}

export function isOffToken(value?: string): boolean {
    return OFF_TOKENS.includes(norm(value));
}

export function isOnToken(value?: string): boolean {
    return ON_TOKENS.includes(norm(value));
}

/**
 * True when the environment disables the ecosystem plugin.
 * SPIDERSAN_CORE_ONLY=1 means "core only" — plugin disabled. Before this fix
 * the check was inverted: CORE_ONLY=0 disabled the plugin and =1 did nothing.
 */
export function isPluginDisabledByEnv(env: Env = process.env): boolean {
    return isOffToken(env.SPIDERSAN_ECOSYSTEM) || isOnToken(env.SPIDERSAN_CORE_ONLY);
}

function expandHome(p: string, home: string): string {
    if (p === '~') return home;
    if (p.startsWith('~/')) return join(home, p.slice(2));
    return p;
}

export type EcosystemRepoSource = 'flag' | 'env' | 'config' | 'none';

export interface EcosystemRepoResolution {
    repos: string[];
    source: EcosystemRepoSource;
}

export const ECOSYSTEM_UNCONFIGURED_HINT =
    'No ecosystem repos configured. Set SPIDERSAN_ECOSYSTEM=/path/to/repo-a:/path/to/repo-b, ' +
    'add "conflicts": { "ecosystemRepos": ["/path/to/repo-a"] } to ~/.spidersanrc, or pass --repos a,b.';

/**
 * Resolve the repo list for `conflicts --ecosystem`.
 * Precedence: --repos flag > SPIDERSAN_ECOSYSTEM path list > config > none.
 */
export function resolveEcosystemRepos(
    config: Pick<SpidersanConfig, 'conflicts'>,
    options: { reposFlag?: string; env?: Env; home?: string } = {},
): EcosystemRepoResolution {
    const env = options.env ?? process.env;
    const home = options.home ?? env.HOME ?? homedir();
    const clean = (list: string[]): string[] =>
        [...new Set(list.map((r) => r.trim()).filter(Boolean).map((r) => expandHome(r, home)))];

    if (options.reposFlag) {
        const repos = clean(options.reposFlag.split(','));
        if (repos.length > 0) return { repos, source: 'flag' };
    }

    const envValue = env.SPIDERSAN_ECOSYSTEM;
    if (envValue && !isOffToken(envValue) && !isOnToken(envValue)) {
        const repos = clean(envValue.split(':'));
        if (repos.length > 0) return { repos, source: 'env' };
    }

    const fromConfig = config.conflicts?.ecosystemRepos;
    if (Array.isArray(fromConfig)) {
        const repos = clean(fromConfig.filter((r): r is string => typeof r === 'string'));
        if (repos.length > 0) return { repos, source: 'config' };
    }

    return { repos: [], source: 'none' };
}
