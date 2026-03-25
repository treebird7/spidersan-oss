import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { _doctorTestable } from '../src/commands/doctor.js';

describe('doctor checkEnvConflict optimizations', () => {
    const { checkEnvConflict } = _doctorTestable;

    it('detects missing newlines after URL', () => {
        fs.writeFileSync('.env', 'A=https://foo.comNEXT=val\n');
        const res = checkEnvConflict();
        expect(res.status).toBe('error');
        expect(res.message).toContain('appears corrupted');
        fs.unlinkSync('.env');
    });

    it('does not skip equal signs check if url matches but internal url check fails', () => {
        fs.writeFileSync('.env', 'KEY==http://example.com\n');
        const res = checkEnvConflict();
        expect(res.status).toBe('error');
        expect(res.message).toContain('multiple');
        fs.unlinkSync('.env');
    });
});
