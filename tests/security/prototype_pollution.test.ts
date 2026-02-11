
import { describe, it, expect, afterEach } from 'vitest';
import { _testable } from '../../src/commands/config.js';
import { deepMerge } from '../../src/lib/config.js';

describe('Prototype Pollution', () => {
    afterEach(() => {
        // Cleanup in case pollution succeeded
        delete (Object.prototype as any).polluted;
        delete (Object.prototype as any).pollutedMerge;
    });

    it('should prevent prototype pollution via setNestedValue', () => {
        const obj = {};
        _testable.setNestedValue(obj, '__proto__.polluted', true);

        expect((({} as any)).polluted).toBeUndefined();
        expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it('should prevent accessing prototype via getNestedValue', () => {
        const obj = {};
        const proto = _testable.getNestedValue(obj, '__proto__');
        expect(proto).toBeUndefined();
    });

    it('should prevent prototype pollution via deepMerge', () => {
        const maliciousPayload = JSON.parse('{"__proto__": {"pollutedMerge": true}}');
        const target = {};
        const result = deepMerge(target, maliciousPayload);

        expect((({} as any)).pollutedMerge).toBeUndefined();
        expect((Object.prototype as any).pollutedMerge).toBeUndefined();
        // Also check result prototype didn't change weirdly
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    });
});
