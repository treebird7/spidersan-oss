/**
 * Spidersan License Verification
 * 
 * Ed25519-based license verification for Pro features.
 * Public key is embedded; private key is kept by treebird for signing.
 */

import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// License storage location
const LICENSE_DIR = join(homedir(), '.spidersan');
const LICENSE_FILE = join(LICENSE_DIR, 'license.key');

// Treebird's public key for license verification (Ed25519)
// This is the ONLY key that can sign valid licenses
const TREEBIRD_PUBLIC_KEY = 'XqIqSlybZGKkKemgLKKl8P9MepnObhcJcxxZHtgG8/o=';

// Free tier limits
export const FREE_TIER_LIMITS = {
    maxConcurrentBranches: 5,
};

// Pro features
export type ProFeature =
    | 'unlimited_branches'
    | 'mcp_server'
    | 'conflict_prediction'
    | 'team_sync';

export interface LicenseData {
    email: string;
    plan: 'free' | 'pro';
    expiresAt: string;    // ISO date
    issuedAt: string;     // ISO date
    features: ProFeature[];
}

export interface License {
    data: LicenseData;
    isValid: boolean;
    isExpired: boolean;
}

/**
 * Ensure license directory exists
 */
function ensureLicenseDir(): void {
    if (!existsSync(LICENSE_DIR)) {
        mkdirSync(LICENSE_DIR, { recursive: true });
    }
}

/**
 * Parse a license string into components
 * Format: LICENSE_V1.BASE64_DATA.BASE64_SIGNATURE
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

        // Production mode - verify detached Ed25519 signature
        const publicKey = util.decodeBase64(TREEBIRD_PUBLIC_KEY);
        const signatureBytes = util.decodeBase64(parsed.signature);

        // Verify the detached signature
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
 * Save a license key to disk
 */
export function saveLicense(licenseString: string): boolean {
    try {
        ensureLicenseDir();
        writeFileSync(LICENSE_FILE, licenseString.trim(), { mode: 0o600 });
        return true;
    } catch {
        return false;
    }
}

/**
 * Load the saved license from disk
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
 * Check if user has a valid Pro license
 */
export function isPro(): boolean {
    const license = loadLicense();
    if (!license) return false;
    if (!license.isValid) return false;
    if (license.isExpired) return false;
    return license.data.plan === 'pro';
}

/**
 * Check if a specific Pro feature is enabled
 */
export function hasFeature(feature: ProFeature): boolean {
    const license = loadLicense();
    if (!license || !license.isValid || license.isExpired) return false;
    return license.data.features.includes(feature);
}

/**
 * Get license status summary
 */
export function getLicenseStatus(): {
    plan: 'free' | 'pro';
    email?: string;
    expiresAt?: string;
    features: ProFeature[];
    daysRemaining?: number;
} {
    const license = loadLicense();

    if (!license || !license.isValid || license.isExpired) {
        return {
            plan: 'free',
            features: [],
        };
    }

    const expiresAt = new Date(license.data.expiresAt);
    const now = new Date();
    const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    return {
        plan: license.data.plan,
        email: license.data.email,
        expiresAt: license.data.expiresAt,
        features: license.data.features,
        daysRemaining,
    };
}

/**
 * Check branch limit and throw if exceeded (for free tier)
 */
export async function checkBranchLimit(currentBranchCount: number): Promise<void> {
    if (isPro()) return; // Pro has unlimited

    if (currentBranchCount >= FREE_TIER_LIMITS.maxConcurrentBranches) {
        console.error(`\n🕷️ Free tier limit reached: ${currentBranchCount}/${FREE_TIER_LIMITS.maxConcurrentBranches} branches`);
        console.error('');
        console.error('   Options:');
        console.error('   • Clean up: spidersan merged <branch> or spidersan abandon <branch>');
        console.error('   • Upgrade:  spidersan.dev/pro for unlimited branches');
        console.error('');
        process.exit(1);
    }
}

/**
 * Print Pro upsell message (soft sell)
 */
export function printProUpsell(feature: string): void {
    if (isPro()) return;

    console.log('');
    console.log(`💎 Pro tip: Upgrade for ${feature}`);
    console.log('   spidersan.dev/pro');
}
