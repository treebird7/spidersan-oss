import { describe, it, expect } from 'vitest';
import { shouldExcludeFile } from '../src/commands/ready-check.js';

describe('ready-check shouldExcludeFile', () => {
  it('excludes package-lock.json by default config pattern', () => {
    const patterns = ['tests/**', '*.test.js', '*.test.ts', '*.md', '**/docs/**', '**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml'];
    expect(shouldExcludeFile('vercel/package-lock.json', patterns)).toBe(true);
    expect(shouldExcludeFile('package-lock.json', patterns)).toBe(true);
  });

  it('does not exclude src files', () => {
    const patterns = ['**/package-lock.json'];
    expect(shouldExcludeFile('src/index.ts', patterns)).toBe(false);
  });
});
