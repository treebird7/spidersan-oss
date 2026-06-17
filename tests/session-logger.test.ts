import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
    appendFileSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => true),
}));

import { appendFileSync, readFileSync } from 'fs';
import { logSession, captureOutcome } from '../src/lib/session-logger.js';

const mockAppend = vi.mocked(appendFileSync);
const mockRead = vi.mocked(readFileSync);

describe('session-logger — never-throws + DEBUG_SESSIONS breadcrumb', () => {
    let errSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        delete process.env.DEBUG_SESSIONS;
    });
    afterEach(() => {
        errSpy.mockRestore();
        delete process.env.DEBUG_SESSIONS;
    });

    it('logSession returns a UUID and never throws even when the append fails', () => {
        mockAppend.mockImplementation(() => { throw new Error('ENOSPC: no space left'); });
        let id = '';
        expect(() => { id = logSession('ask' as never, {} as never, {} as never, { question: 'q' }); })
            .not.toThrow();
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('emits a [sessions] breadcrumb (with the cause) on failure when DEBUG_SESSIONS is set', () => {
        process.env.DEBUG_SESSIONS = '1';
        mockAppend.mockImplementation(() => { throw new Error('ENOSPC: no space left'); });
        logSession('ask' as never, {} as never, {} as never);
        expect(errSpy).toHaveBeenCalledTimes(1);
        const msg = String(errSpy.mock.calls[0][0]);
        expect(msg).toContain('[sessions]');
        expect(msg).toContain('ENOSPC');
    });

    it('stays fully silent on failure when DEBUG_SESSIONS is unset', () => {
        mockAppend.mockImplementation(() => { throw new Error('ENOSPC'); });
        logSession('ask' as never, {} as never, {} as never);
        expect(errSpy).not.toHaveBeenCalled();
    });

    it('does NOT emit a breadcrumb on the happy path', () => {
        process.env.DEBUG_SESSIONS = '1';
        mockAppend.mockImplementation(() => { /* success */ });
        logSession('ask' as never, {} as never, {} as never);
        expect(errSpy).not.toHaveBeenCalled();
    });

    it('captureOutcome never throws and breadcrumbs a read failure under DEBUG_SESSIONS', () => {
        process.env.DEBUG_SESSIONS = '1';
        mockRead.mockImplementation(() => { throw new Error('EACCES: permission denied'); });
        expect(() => captureOutcome('some-id', 'followed')).not.toThrow();
        expect(errSpy).toHaveBeenCalledTimes(1);
        const msg = String(errSpy.mock.calls[0][0]);
        expect(msg).toContain('[sessions]');
        expect(msg).toContain('some-id');
    });
});
