/**
 * License Status Command
 * 
 * Shows current license status and plan details.
 * Usage: spidersan status
 */

import { Command } from 'commander';
import { getLicenseStatus, FREE_TIER_LIMITS } from '../lib/license.js';
import { getStorage } from '../storage/index.js';

export const statusCommand = new Command('status')
    .description('Show license status and plan details')
    .action(async () => {
        const status = getLicenseStatus();
        const storage = await getStorage();

        let branchCount = 0;
        if (await storage.isInitialized()) {
            const branches = await storage.list();
            branchCount = branches.filter(b => b.status === 'active').length;
        }

        console.log('🕷️ Spidersan Status\n');

        if (status.plan === 'pro') {
            console.log(`   Plan:      💎 Pro`);
            console.log(`   Email:     ${status.email}`);
            console.log(`   Expires:   ${new Date(status.expiresAt!).toLocaleDateString()} (${status.daysRemaining} days)`);
            console.log(`   Features:  ${status.features.join(', ')}`);
            console.log(`   Branches:  ${branchCount} active (unlimited)`);
        } else {
            console.log(`   Plan:      Free`);
            console.log(`   Branches:  ${branchCount}/${FREE_TIER_LIMITS.maxConcurrentBranches} active`);
            console.log('');
            console.log('   💎 Upgrade to Pro for:');
            console.log('      • Unlimited branches');
            console.log('      • MCP Server integration');
            console.log('      • Conflict prediction');
            console.log('      • Priority support');
            console.log('');
            console.log('   Get Pro: spidersan.dev/pro');
        }
    });
