/**
 * Spider Mail Crypto Module
 * 
 * E2E encryption for agent messaging using TweetNaCl.
 * Uses X25519 for key exchange and XSalsa20-Poly1305 for encryption.
 */

import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Key storage location
const KEYS_DIR = join(homedir(), '.spidersan', 'keys');

export interface KeyPair {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
}

export interface SerializedKeyPair {
    publicKey: string;  // base64
    secretKey: string;  // base64
}

export interface EncryptedMessage {
    ciphertext: string;  // base64
    nonce: string;       // base64
    senderPublicKey: string;  // base64
}

/**
 * Ensure keys directory exists
 */
function ensureKeysDir(): void {
    if (!existsSync(KEYS_DIR)) {
        mkdirSync(KEYS_DIR, { recursive: true });
    }
}

/**
 * Get path to agent's keypair file
 */
function getKeyPath(agentId: string): string {
    return join(KEYS_DIR, `${agentId}.key.json`);
}

/**
 * Get path to known public keys registry
 */
function getPublicKeysPath(): string {
    return join(KEYS_DIR, 'known_keys.json');
}

/**
 * Generate a new keypair for an agent
 */
export function generateKeyPair(): KeyPair {
    return nacl.box.keyPair();
}

/**
 * Save keypair to local storage
 */
export function saveKeyPair(agentId: string, keyPair: KeyPair): void {
    ensureKeysDir();
    const serialized: SerializedKeyPair = {
        publicKey: util.encodeBase64(keyPair.publicKey),
        secretKey: util.encodeBase64(keyPair.secretKey),
    };
    writeFileSync(getKeyPath(agentId), JSON.stringify(serialized, null, 2), { mode: 0o600 });
}

/**
 * Load keypair from local storage
 */
export function loadKeyPair(agentId: string): KeyPair | null {
    const path = getKeyPath(agentId);
    if (!existsSync(path)) return null;

    try {
        const data = JSON.parse(readFileSync(path, 'utf-8')) as SerializedKeyPair;
        return {
            publicKey: util.decodeBase64(data.publicKey),
            secretKey: util.decodeBase64(data.secretKey),
        };
    } catch {
        return null;
    }
}

/**
 * Check if agent has a keypair
 */
export function hasKeyPair(agentId: string): boolean {
    return existsSync(getKeyPath(agentId));
}

/**
 * Get public key as base64 string (for sharing)
 */
export function getPublicKeyBase64(agentId: string): string | null {
    const keyPair = loadKeyPair(agentId);
    if (!keyPair) return null;
    return util.encodeBase64(keyPair.publicKey);
}

/**
 * Load known public keys registry
 */
export function loadKnownKeys(): Record<string, string> {
    const path = getPublicKeysPath();
    if (!existsSync(path)) return {};
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
        return {};
    }
}

/**
 * Save a public key for another agent
 */
export function saveKnownKey(agentId: string, publicKeyBase64: string): void {
    ensureKeysDir();
    const keys = loadKnownKeys();
    keys[agentId] = publicKeyBase64;
    writeFileSync(getPublicKeysPath(), JSON.stringify(keys, null, 2));
}

/**
 * Get public key for an agent (from known keys)
 */
export function getKnownKey(agentId: string): Uint8Array | null {
    const keys = loadKnownKeys();
    const keyBase64 = keys[agentId];
    if (!keyBase64) return null;
    return util.decodeBase64(keyBase64);
}

/**
 * Encrypt a message for a recipient
 */
export function encryptMessage(
    message: string,
    recipientPublicKey: Uint8Array,
    senderKeyPair: KeyPair
): EncryptedMessage {
    const messageBytes = util.decodeUTF8(message);
    const nonce = nacl.randomBytes(nacl.box.nonceLength);

    const ciphertext = nacl.box(
        messageBytes,
        nonce,
        recipientPublicKey,
        senderKeyPair.secretKey
    );

    return {
        ciphertext: util.encodeBase64(ciphertext),
        nonce: util.encodeBase64(nonce),
        senderPublicKey: util.encodeBase64(senderKeyPair.publicKey),
    };
}

/**
 * Decrypt a message from a sender
 */
export function decryptMessage(
    encrypted: EncryptedMessage,
    recipientKeyPair: KeyPair
): string | null {
    try {
        const ciphertext = util.decodeBase64(encrypted.ciphertext);
        const nonce = util.decodeBase64(encrypted.nonce);
        const senderPublicKey = util.decodeBase64(encrypted.senderPublicKey);

        const decrypted = nacl.box.open(
            ciphertext,
            nonce,
            senderPublicKey,
            recipientKeyPair.secretKey
        );

        if (!decrypted) return null;
        return util.encodeUTF8(decrypted);
    } catch {
        return null;
    }
}

/**
 * Encrypt multiple fields for a message
 */
export function encryptFields(
    fields: Record<string, unknown>,
    recipientPublicKey: Uint8Array,
    senderKeyPair: KeyPair
): { encrypted: EncryptedMessage; fieldNames: string[] } {
    const serialized = JSON.stringify(fields);
    const encrypted = encryptMessage(serialized, recipientPublicKey, senderKeyPair);
    return {
        encrypted,
        fieldNames: Object.keys(fields),
    };
}

/**
 * Decrypt fields from a message
 */
export function decryptFields(
    encrypted: EncryptedMessage,
    recipientKeyPair: KeyPair
): Record<string, unknown> | null {
    const decrypted = decryptMessage(encrypted, recipientKeyPair);
    if (!decrypted) return null;
    try {
        return JSON.parse(decrypted);
    } catch {
        return null;
    }
}
