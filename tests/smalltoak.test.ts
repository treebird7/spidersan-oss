import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { probeSmalltoak } from '../src/lib/smalltoak.js';

describe('probeSmalltoak — comms-bridge down-detection (tb-r9s)', () => {
    const savedUrl = process.env.SMALLTOAK_SERVER_URL;
    const savedFetch = global.fetch;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        global.fetch = savedFetch;
        if (savedUrl === undefined) delete process.env.SMALLTOAK_SERVER_URL;
        else process.env.SMALLTOAK_SERVER_URL = savedUrl;
    });

    it('is a no-op (configured:false) when SMALLTOAK_SERVER_URL is unset', async () => {
        delete process.env.SMALLTOAK_SERVER_URL;
        const h = await probeSmalltoak();
        expect(h).toEqual({ configured: false });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports reachable + status on any HTTP response, hitting /health', async () => {
        process.env.SMALLTOAK_SERVER_URL = 'http://localhost:3000/';
        fetchMock.mockResolvedValue({ status: 200 } as Response);
        const h = await probeSmalltoak();
        expect(h).toEqual({ configured: true, url: 'http://localhost:3000', reachable: true, status: 200 });
        expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/health', expect.anything());
    });

    it('treats a non-2xx response as reachable (server is up, route may 404)', async () => {
        process.env.SMALLTOAK_SERVER_URL = 'http://localhost:3000';
        fetchMock.mockResolvedValue({ status: 404 } as Response);
        const h = await probeSmalltoak();
        expect(h.reachable).toBe(true);
        expect(h.status).toBe(404);
    });

    it('reports DOWN (reachable:false + error) on network failure', async () => {
        process.env.SMALLTOAK_SERVER_URL = 'http://localhost:3000';
        fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
        const h = await probeSmalltoak();
        expect(h.configured).toBe(true);
        expect(h.reachable).toBe(false);
        expect(h.error).toContain('ECONNREFUSED');
    });
});
