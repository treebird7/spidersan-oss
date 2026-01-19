/**
 * Spidersan License Verification for MCP
 * 
 * Ed25519-based license verification for MCP Pro features.
 * MCP server is a Pro feature - requires valid license to start.
 */

import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// License storage location
const LICENSE_FILE = join(homedir(), '.spidersan', 'license.key');

// Treebird's public key for license verification (Ed25519)
const TREEBIRD_PUBLIC_KEY = 'XqIqSlybZGKkKemgLKKl8P9MepnObhcJcxxZHtgG8/o=';

export interface LicenseData {
    email: string;
    plan: 'free' | 'pro';
    expiresAt: string;
    issuedAt: string;
    features: string[];
}

export interface License {
    data: LicenseData;
    isValid: boolean;
    isExpired: boolean;
}

/**
 * Parse a license string into components
 */
function parseLicenseString(licenseString: string): { version: string; data: string; signature: string } | null {
    const parts = licenseString.trim().split('.');
    if (parts.length !== 3) return null;

    const [version, data, signature] = parts;
    if (version !== 'LICENSE_V1') return null;

    return { version, data, signature };
}

/**
 * Verify a license string using Ed25519 detached signature
 */
export function verifyLicense(licenseString: string): License | null {
    try {
        const parsed = parseLicenseString(licenseString);
        if (!parsed) return null;

        const dataBytes = util.decodeBase64(parsed.data);
        const publicKey = util.decodeBase64(TREEBIRD_PUBLIC_KEY);
        const signatureBytes = util.decodeBase64(parsed.signature);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isValid = (nacl as any).sign.detached.verify(dataBytes, signatureBytes, publicKey);
        if (!isValid) return null;

        const dataString = util.encodeUTF8(dataBytes);
        const data = JSON.parse(dataString) as LicenseData;

        const expiresAt = new Date(data.expiresAt);
        const isExpired = expiresAt < new Date();

        return {
            data,
            isValid: true,
            isExpired,
        };
    } catch {
        return null;
    }
}

/**
 * Load and verify license from disk
 */
export function loadLicense(): License | null {
    if (!existsSync(LICENSE_FILE)) return null;

    try {
        const licenseString = readFileSync(LICENSE_FILE, 'utf-8');
        return verifyLicense(licenseString);
    } catch {
        return null;
    }
}

/**
 * Verify Pro license or exit with upgrade message
 */
export function requireProLicense(): void {
    const license = loadLicense();

    if (!license) {
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('🕷️ Spidersan MCP Server - Pro Feature');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('');
        console.error('This feature requires a Pro license.');
        console.error('');
        console.error('Activate with: spidersan activate <license-key>');
        console.error('Get a license: spidersan.dev/pro');
        console.error('');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        process.exit(1);
    }

    if (!license.isValid) {
        console.error('❌ Invalid license. Please re-activate.');
        console.error('   spidersan activate <license-key>');
        process.exit(1);
    }

    if (license.isExpired) {
        console.error('❌ License expired on', new Date(license.data.expiresAt).toLocaleDateString());
        console.error('   Renew at: spidersan.dev/pro');
        process.exit(1);
    }

    // Valid Pro license - show confirmation
    console.error(`🕷️ Spidersan MCP (Pro) - ${license.data.email}`);
}
