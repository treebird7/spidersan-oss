/**
 * License Activation Command
 * 
 * Activates a Pro license key.
 * Usage: spidersan activate <license-key>
 */

import { Command } from 'commander';
import { verifyLicense, saveLicense, getLicenseStatus } from '../lib/license.js';

export const activateCommand = new Command('activate')
    .description('Activate a Pro license key')
    .argument('<license-key>', 'Your license key from spidersan.dev/pro')
    .action(async (licenseKey: string) => {
        console.log('🕷️ Activating license...\n');

        // Verify the license
        const license = verifyLicense(licenseKey);

        if (!license) {
            console.error('❌ Invalid license key');
            console.error('   Please check your key and try again.');
            console.error('   Get a license at: spidersan.dev/pro');
            process.exit(1);
        }

        if (license.isExpired) {
            console.error('❌ This license has expired');
            console.error(`   Expired on: ${new Date(license.data.expiresAt).toLocaleDateString()}`);
            console.error('   Renew at: spidersan.dev/pro');
            process.exit(1);
        }

        // Save the license
        const saved = saveLicense(licenseKey);
        if (!saved) {
            console.error('❌ Failed to save license');
            console.error('   Please check file permissions for ~/.spidersan/');
            process.exit(1);
        }

        // Show success
        const status = getLicenseStatus();
        console.log('✅ Pro License activated!\n');
        console.log(`   Email:    ${status.email}`);
        console.log(`   Plan:     ${status.plan.toUpperCase()}`);
        console.log(`   Expires:  ${new Date(status.expiresAt!).toLocaleDateString()}`);
        console.log(`   Features: ${status.features.join(', ')}`);
        console.log('');
        console.log('🕷️ Thank you for supporting Spidersan!');
    });
