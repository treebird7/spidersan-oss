/**
 * Update Check Module
 * 
 * Checks npm registry for newer versions and displays update notification.
 * Non-blocking, fails silently.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.spidersan');
const UPDATE_CACHE = join(CONFIG_DIR, 'update-cache.json');
const PACKAGE_NAME = 'spidersan';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface UpdateCache {
    lastCheck: number;
    latestVersion: string | null;
}

/**
 * Get current installed version
 */
function getCurrentVersion(): string {
    try {
        const packagePath = new URL('../../package.json', import.meta.url);
        const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
        return pkg.version;
    } catch {
        return '0.0.0';
    }
}

/**
 * Load update cache
 */
function loadCache(): UpdateCache {
    try {
        if (existsSync(UPDATE_CACHE)) {
            return JSON.parse(readFileSync(UPDATE_CACHE, 'utf-8'));
        }
    } catch {
        // Ignore
    }
    return { lastCheck: 0, latestVersion: null };
}

/**
 * Save update cache
 */
function saveCache(cache: UpdateCache): void {
    try {
        if (!existsSync(CONFIG_DIR)) {
            mkdirSync(CONFIG_DIR, { recursive: true });
        }
        writeFileSync(UPDATE_CACHE, JSON.stringify(cache));
    } catch {
        // Ignore
    }
}

/**
 * Compare semantic versions
 */
function isNewerVersion(current: string, latest: string): boolean {
    const currentParts = current.split('.').map(Number);
    const latestParts = latest.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
        if ((latestParts[i] || 0) > (currentParts[i] || 0)) return true;
        if ((latestParts[i] || 0) < (currentParts[i] || 0)) return false;
    }
    return false;
}

/**
 * Check for updates (non-blocking)
 */
export async function checkForUpdates(): Promise<void> {
    try {
        const cache = loadCache();
        const now = Date.now();

        // Only check once per day
        if (now - cache.lastCheck < CHECK_INTERVAL_MS && cache.latestVersion) {
            showUpdateNotification(cache.latestVersion);
            return;
        }

        // Fetch latest version from npm (with timeout)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(
            `https://registry.npmjs.org/${PACKAGE_NAME}/latest`,
            { signal: controller.signal }
        );
        clearTimeout(timeout);

        if (!response.ok) return;

        const data = await response.json() as { version: string };
        const latestVersion = data.version;

        // Update cache
        saveCache({ lastCheck: now, latestVersion });

        // Show notification if newer
        showUpdateNotification(latestVersion);
    } catch {
        // Silent fail - don't interrupt user
    }
}

/**
 * Display update notification if newer version available
 */
function showUpdateNotification(latestVersion: string): void {
    const currentVersion = getCurrentVersion();

    if (isNewerVersion(currentVersion, latestVersion)) {
        console.log('');
        console.log('╭─────────────────────────────────────────────╮');
        console.log(`│  🕷️ Update available: ${currentVersion} → ${latestVersion.padEnd(10)}    │`);
        console.log('│  Run: npm install -g spidersan              │');
        console.log('╰─────────────────────────────────────────────╯');
        console.log('');
    }
}
