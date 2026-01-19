#!/usr/bin/env node
/**
 * License Generator Script (KEEP PRIVATE - DO NOT COMMIT)
 * 
 * Generates signed license keys for Spidersan Pro.
 * Store this script securely, NOT in the repo.
 * 
 * Usage:
 *   node generate-license.mjs user@email.com 365
 * 
 * Output:
 *   LICENSE_V1.BASE64_DATA.BASE64_SIGNATURE
 */

import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const KEYS_FILE = './license-keys.json'; // Store securely!

// Generate or load keypair
function getKeyPair() {
    if (existsSync(KEYS_FILE)) {
        const data = JSON.parse(readFileSync(KEYS_FILE, 'utf-8'));
        return {
            publicKey: util.decodeBase64(data.publicKey),
            secretKey: util.decodeBase64(data.secretKey),
        };
    }

    // Generate new keypair
    const keyPair = nacl.sign.keyPair();
    const data = {
        publicKey: util.encodeBase64(keyPair.publicKey),
        secretKey: util.encodeBase64(keyPair.secretKey),
    };
    writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2));
    console.log('🔑 Generated new keypair!');
    console.log(`   Public key: ${data.publicKey}`);
    console.log(`   (Add this to license.ts TREEBIRD_PUBLIC_KEY)`);
    console.log('');
    return keyPair;
}

function generateLicense(email, daysValid = 365) {
    const keyPair = getKeyPair();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + daysValid * 24 * 60 * 60 * 1000);

    const licenseData = {
        email,
        plan: 'pro',
        expiresAt: expiresAt.toISOString(),
        issuedAt: now.toISOString(),
        features: ['unlimited_branches', 'mcp_server', 'conflict_prediction', 'team_sync'],
    };

    // Encode data
    const dataString = JSON.stringify(licenseData);
    const dataBytes = util.decodeUTF8(dataString);
    const dataBase64 = util.encodeBase64(dataBytes);

    // Sign data (detached signature)
    const signature = nacl.sign.detached(dataBytes, keyPair.secretKey);
    const signatureBase64 = util.encodeBase64(signature);

    // Create license string
    const licenseString = `LICENSE_V1.${dataBase64}.${signatureBase64}`;

    return licenseString;
}

// CLI
const email = process.argv[2];
const days = parseInt(process.argv[3] || '365', 10);

if (!email) {
    console.log('Usage: node generate-license.mjs <email> [days-valid]');
    console.log('Example: node generate-license.mjs user@example.com 365');
    process.exit(1);
}

console.log(`\n🔐 Generating Pro license for: ${email}`);
console.log(`   Valid for: ${days} days\n`);

const license = generateLicense(email, days);
console.log('📋 License Key:\n');
console.log(license);
console.log('\n');
