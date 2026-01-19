/**
 * spidersan pulse
 * 
 * The spider's self-awareness command.
 * "I have my senses and my sense of having senses" - Robert Wyatt
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { existsSync, statSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getStorage } from '../storage/index.js';

interface PulseData {
    health: 'strong' | 'steady' | 'weak' | 'dormant';
    registry: {
        initialized: boolean;
        totalBranches: number;
        activeBranches: number;
        staleBranches: number;
        abandonedBranches: number;
        agents: string[];
        oldestActive: Date | null;
        newestActive: Date | null;
    };
    completeness: {
        unregisteredBranches: string[];
        score: number; // 0-100
    };
    lastActivity: {
        lastSync: Date | null;
        daysSinceActivity: number | null;
    };
    storage: {
        type: 'local' | 'supabase' | 'unknown';
        sizeBytes: number | null;
    };
}

function getGitBranches(): string[] {
    try {
        const output = execSync('git branch --format="%(refname:short)"', { encoding: 'utf-8' });
        return output.trim().split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

function getStorageType(): 'local' | 'supabase' | 'unknown' {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
        return 'supabase';
    }
    const localPath = join(process.cwd(), '.spidersan', 'registry.json');
    const globalPath = join(homedir(), '.spidersan', 'registry.json');
    if (existsSync(localPath) || existsSync(globalPath)) {
        return 'local';
    }
    return 'unknown';
}

function getStorageSize(): number | null {
    try {
        const localPath = join(process.cwd(), '.spidersan', 'registry.json');
        const globalPath = join(homedir(), '.spidersan', 'registry.json');
        const path = existsSync(localPath) ? localPath : globalPath;
        if (existsSync(path)) {
            return statSync(path).size;
        }
    } catch {
        // Ignore
    }
    return null;
}

function daysBetween(date1: Date, date2: Date): number {
    const diffMs = Math.abs(date2.getTime() - date1.getTime());
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function determineHealth(pulse: PulseData): 'strong' | 'steady' | 'weak' | 'dormant' {
    // Dormant: not initialized or no activity
    if (!pulse.registry.initialized) return 'dormant';
    if (pulse.registry.activeBranches === 0) return 'dormant';

    // Weak: high stale count or low completeness
    if (pulse.registry.staleBranches > pulse.registry.activeBranches) return 'weak';
    if (pulse.completeness.score < 50) return 'weak';

    // Steady: some issues but functional
    if (pulse.completeness.score < 80) return 'steady';
    if (pulse.registry.staleBranches > 0) return 'steady';

    // Strong: healthy web
    return 'strong';
}

export const pulseCommand = new Command('pulse')
    .description("Feel the web's heartbeat - the spider's self-awareness")
    .option('--json', 'Output as JSON')
    .option('-q, --quiet', 'Minimal output')
    .action(async (options) => {
        const storage = await getStorage();
        const now = new Date();
        const STALE_DAYS = 7;

        const pulse: PulseData = {
            health: 'dormant',
            registry: {
                initialized: false,
                totalBranches: 0,
                activeBranches: 0,
                staleBranches: 0,
                abandonedBranches: 0,
                agents: [],
                oldestActive: null,
                newestActive: null,
            },
            completeness: {
                unregisteredBranches: [],
                score: 0,
            },
            lastActivity: {
                lastSync: null,
                daysSinceActivity: null,
            },
            storage: {
                type: getStorageType(),
                sizeBytes: getStorageSize(),
            },
        };

        // Check if initialized
        pulse.registry.initialized = await storage.isInitialized();

        if (pulse.registry.initialized) {
            const branches = await storage.list();
            const gitBranches = new Set(getGitBranches());

            // Count by status
            const active = branches.filter(b => b.status === 'active');
            const stale = active.filter(b => daysBetween(new Date(b.registeredAt), now) > STALE_DAYS);
            const abandoned = branches.filter(b => b.status === 'abandoned');

            pulse.registry.totalBranches = branches.length;
            pulse.registry.activeBranches = active.length;
            pulse.registry.staleBranches = stale.length;
            pulse.registry.abandonedBranches = abandoned.length;

            // Unique agents
            const agents = new Set(branches.map(b => b.agent).filter((a): a is string => !!a));
            pulse.registry.agents = Array.from(agents);

            // Date ranges
            if (active.length > 0) {
                const dates = active.map(b => new Date(b.registeredAt).getTime());
                pulse.registry.oldestActive = new Date(Math.min(...dates));
                pulse.registry.newestActive = new Date(Math.max(...dates));
                pulse.lastActivity.lastSync = pulse.registry.newestActive;
                pulse.lastActivity.daysSinceActivity = daysBetween(pulse.registry.newestActive, now);
            }

            // Completeness: find git branches not in registry
            const registeredNames = new Set(branches.map(b => b.name));
            const unregistered = Array.from(gitBranches).filter(
                b => !registeredNames.has(b) && b !== 'main' && b !== 'master'
            );
            pulse.completeness.unregisteredBranches = unregistered;

            // Calculate completeness score
            const relevantBranches = Array.from(gitBranches).filter(b => b !== 'main' && b !== 'master');
            if (relevantBranches.length === 0) {
                pulse.completeness.score = 100; // No branches to track
            } else {
                const tracked = relevantBranches.filter(b => registeredNames.has(b)).length;
                pulse.completeness.score = Math.round((tracked / relevantBranches.length) * 100);
            }
        }

        // Determine overall health
        pulse.health = determineHealth(pulse);

        // JSON output
        if (options.json) {
            console.log(JSON.stringify(pulse, null, 2));
            return;
        }

        // Quiet output
        if (options.quiet) {
            const healthEmoji = { strong: '💚', steady: '💛', weak: '🧡', dormant: '💤' };
            console.log(`${healthEmoji[pulse.health]} ${pulse.health} | ${pulse.registry.activeBranches} active | ${pulse.completeness.score}% tracked`);
            return;
        }

        // ═══════════════════════════════════════════════════════════
        // CEREMONIAL OUTPUT: "The Spider Feels Its Web"
        // ═══════════════════════════════════════════════════════════

        console.log('');
        console.log('🕷️  Spidersan Pulse');
        console.log('');

        // Health indicator
        const healthDisplay = {
            strong: ['💚', 'STRONG', 'The web holds firm.'],
            steady: ['💛', 'STEADY', 'The web is functional.'],
            weak: ['🧡', 'WEAK', 'The web needs attention.'],
            dormant: ['💤', 'DORMANT', 'The spider sleeps...'],
        };
        const [emoji, label, tagline] = healthDisplay[pulse.health];

        console.log('   ╭─────────────────────────────────────╮');
        console.log(`   │  ${emoji} Web Health: ${label.padEnd(23)} │`);
        console.log('   ╰─────────────────────────────────────╯');
        console.log(`      "${tagline}"`);
        console.log('');

        // Registry overview
        console.log('   📊 Registry:');
        console.log(`      • ${pulse.registry.activeBranches} active thread${pulse.registry.activeBranches !== 1 ? 's' : ''}`);
        if (pulse.registry.staleBranches > 0) {
            console.log(`      • ${pulse.registry.staleBranches} stale (older than ${STALE_DAYS} days)`);
        }
        if (pulse.registry.abandonedBranches > 0) {
            console.log(`      • ${pulse.registry.abandonedBranches} abandoned`);
        }
        if (pulse.registry.agents.length > 0) {
            console.log(`      • Agents: ${pulse.registry.agents.join(', ')}`);
        }

        // Completeness
        console.log('');
        console.log('   🎯 Completeness:');
        const scoreBar = '█'.repeat(Math.floor(pulse.completeness.score / 10)) +
            '░'.repeat(10 - Math.floor(pulse.completeness.score / 10));
        console.log(`      [${scoreBar}] ${pulse.completeness.score}%`);
        if (pulse.completeness.unregisteredBranches.length > 0) {
            console.log('      ⚠️  Untracked branches:');
            for (const branch of pulse.completeness.unregisteredBranches.slice(0, 3)) {
                console.log(`         └─ ${branch}`);
            }
            if (pulse.completeness.unregisteredBranches.length > 3) {
                console.log(`         └─ +${pulse.completeness.unregisteredBranches.length - 3} more`);
            }
        } else if (pulse.completeness.score === 100) {
            console.log('      ✅ All branches tracked');
        }

        // Activity
        if (pulse.lastActivity.daysSinceActivity !== null) {
            console.log('');
            console.log('   ⏱️  Activity:');
            if (pulse.lastActivity.daysSinceActivity === 0) {
                console.log('      • Last activity: today');
            } else if (pulse.lastActivity.daysSinceActivity === 1) {
                console.log('      • Last activity: yesterday');
            } else {
                console.log(`      • Last activity: ${pulse.lastActivity.daysSinceActivity} days ago`);
            }
        }

        // Storage info
        console.log('');
        console.log('   💾 Storage:');
        console.log(`      • Type: ${pulse.storage.type}`);
        if (pulse.storage.sizeBytes !== null) {
            const kb = (pulse.storage.sizeBytes / 1024).toFixed(1);
            console.log(`      • Size: ${kb} KB`);
        }

        // Wyatt's question
        console.log('');
        console.log('   ╭─────────────────────────────────────╮');
        console.log('   │  "Do I guide them? Or they me?"     │');
        console.log('   ╰─────────────────────────────────────╯');
        console.log('');
    });
