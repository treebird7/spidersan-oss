/**
 * spidersan rescue
 * 
 * Rescue Mission:
 * 1. Scan for untracked files (aliens)
 * 2. Scan for unregistered branches (ghosts)
 * 3. Triage & Salvage
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { getStorage } from '../storage/index.js';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, basename } from 'path';
import { validateRepoPath, validateBranchName } from '../lib/security.js';
import { analyzeSalvage, formatSalvageReport } from '../lib/salvage-analyzer.js';

export const rescueCommand = new Command('rescue')
    .description('🚑 Rescue Mode - Scan for and salvage rogue work')
    .option('--scan', 'Scan for problems')
    .option('--salvage <file>', 'Salvage a specific file to ./salvage/')
    .option('--abandon <file>', 'Delete a rogue file')
    .option('--symbols <branch>', 'Analyse abandoned branch for salvageable symbols (Phase C3)')
    .option('--json', 'Output as JSON (use with --symbols for Rust bridge parsing)')
    .action(async (options) => {
        const storage = await getStorage();
        console.log('\n🚑 SPIDERSAN RESCUE MISSION\n━━━━━━━━━━━━━━━━━━━━━━━━━━');

        // 1. Scan for Untracked Files
        let untracked: string[] = [];
        try {
            const output = execSync('git status --porcelain', { encoding: 'utf-8' });
            untracked = output.split('\n')
                .filter(line => line.startsWith('?? '))
                .map(line => line.substring(3));
        } catch (e) {
            console.error('❌ Failed to scan git status');
        }

        // 2. Scan for Unregistered Branches
        let ghosts: string[] = [];
        try {
            const localBranches = execSync('git branch --format="%(refname:short)"', { encoding: 'utf-8' })
                .split('\n').filter(Boolean);

            const registered = await storage.list();
            const registeredNames = new Set(registered.map(b => b.name));

            ghosts = localBranches.filter(b => !registeredNames.has(b) && b !== 'main' && b !== 'master');
        } catch (e) {
            console.error('❌ Failed to scan branches');
        }

        if (options.scan) {
            console.log(`\n🔍 SCAN RESULTS:`);

            if (untracked.length === 0 && ghosts.length === 0) {
                console.log('   ✅ Sector clear. No anomalies detected.');
                return;
            }

            if (untracked.length > 0) {
                console.log(`\n👽 Untracked Files (${untracked.length}):`);
                untracked.forEach(f => console.log(`   - ${f}`));
            }

            if (ghosts.length > 0) {
                console.log(`\n👻 Ghost Branches (${ghosts.length}):`);
                ghosts.forEach(b => console.log(`   - ${b}`));
            }

            console.log('\n💡 Actions:');
            console.log('   spidersan rescue --salvage <file>');
            console.log('   spidersan rescue --abandon <file>');
            return;
        }

        // Salvage Operation
        if (options.salvage) {
            // Security: Validate path is within repo to prevent arbitrary file read
            let target = options.salvage;
            try {
                target = validateRepoPath(target);
            } catch (err) {
                if (err instanceof Error) {
                    console.error(`❌ Security Error: ${err.message}`);
                }
                process.exit(1);
            }

            if (!untracked.includes(options.salvage) && existsSync(target)) {
                console.log(`⚠️  File '${options.salvage}' is tracked by git. Use git commands instead.`);
            }

            const salvageDir = 'salvage';
            if (!existsSync(salvageDir)) mkdirSync(salvageDir);

            const dest = join(salvageDir, basename(target));
            copyFileSync(target, dest);
            console.log(`✅ Salvaged '${basename(target)}' to '${dest}'`);
            return;
        }

        // Abandon Operation
        if (options.abandon) {
            let target = options.abandon;
            // Security: Validate path is within repo
            try {
                target = validateRepoPath(target);
            } catch (err) {
                if (err instanceof Error) {
                    console.error(`❌ Security Error: ${err.message}`);
                }
                process.exit(1);
            }

            // In a real CLI we'd ask for confirmation, for now just warn
            console.log(`⚠️  Deleting '${basename(target)}'... (Simulated)`);
            // rmSync(target); // Safety first for this demo
            console.log(`🗑️  Abandoned '${basename(target)}'`);
            return;
        }

        // Symbol salvage analysis (Phase C3)
        if (options.symbols) {
            let branch: string;
            try {
                branch = validateBranchName(options.symbols as string);
            } catch (err) {
                console.error(`❌ ${(err as Error).message}`);
                process.exit(1);
            }
            if (!options.json) {
                console.log(`\n🔬 Analysing salvageable symbols in "${branch!}"...\n`);
            }
            try {
                const report = await analyzeSalvage(branch!);
                if (options.json) {
                    console.log(JSON.stringify(report, null, 2));
                } else {
                    console.log(formatSalvageReport(report));
                }
            } catch (err) {
                if (options.json) {
                    console.log(JSON.stringify({ error: (err as Error).message }));
                } else {
                    console.error(`❌ ${(err as Error).message}`);
                }
                process.exit(1);
            }
            return;
        }

        // Default: Run scan
        console.log('Use --scan to see anomalies.');
    });
