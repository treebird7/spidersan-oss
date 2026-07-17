/**
 * Single source of truth for this machine's identity (~/.envoak/machine.json).
 *
 * Four near-copies of this loader had drifted apart (registry-sync, dashboard,
 * github-sync, and an inline one in cross-conflicts): two read `id || machine_id`,
 * one read `machine_id || id`, and the missing-file fallback was either
 * `fallback-<hostname>` or the literal 'unknown'. The id is used to exclude THIS
 * machine when pulling cross-machine registries, so a divergent fallback means a
 * machine can fail to filter itself out and conflict against its own branches
 * (tb-ly0b).
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir, hostname as osHostname } from 'os';
import type { MachineIdentity } from '../types/cloud.js';

export async function loadMachineIdentity(): Promise<MachineIdentity> {
    const configPath = join(homedir(), '.envoak', 'machine.json');

    if (existsSync(configPath)) {
        try {
            const data = JSON.parse(await readFile(configPath, 'utf-8'));
            const id = data.id || data.machine_id;
            if (id) {
                return {
                    id,
                    name: data.name || data.machine_name || 'unknown',
                    hostname: data.hostname || 'unknown',
                };
            }
        } catch {
            // Unreadable/corrupt machine.json — fall through to the hostname
            // fallback rather than throwing; identity is advisory, not critical.
        }
    }

    const host = osHostname();
    return { id: `fallback-${host}`, name: host, hostname: host };
}
