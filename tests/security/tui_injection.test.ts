import { describe, it, expect } from 'vitest';
import { escapeBlessed } from '../../src/lib/security.js';

describe('TUI Security', () => {
    describe('escapeBlessed', () => {
        it('should escape curly braces', () => {
            const input = 'Hello {world}';
            const expected = 'Hello {open}world{close}';
            expect(escapeBlessed(input)).toBe(expected);
        });

        it('should escape blessed tags', () => {
            const input = '{red-fg}Danger{/red-fg}';
            const expected = '{open}red-fg{close}Danger{open}/red-fg{close}';
            expect(escapeBlessed(input)).toBe(expected);
        });

        it('should escape nested tags', () => {
            const input = '{bold}Deep {blue-bg}impact{/blue-bg}{/bold}';
            const expected = '{open}bold{close}Deep {open}blue-bg{close}impact{open}/blue-bg{close}{open}/bold{close}';
            expect(escapeBlessed(input)).toBe(expected);
        });

        it('should handle empty strings', () => {
            expect(escapeBlessed('')).toBe('');
        });

        it('should handle strings without special characters', () => {
            const input = 'Just normal text';
            expect(escapeBlessed(input)).toBe(input);
        });

        it('should handle strings with only special characters', () => {
            const input = '{}';
            const expected = '{open}{close}';
            expect(escapeBlessed(input)).toBe(expected);
        });
    });
});
