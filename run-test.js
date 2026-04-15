import { syncFromColony } from './src/lib/colony-subscriber.js';
import { LocalStorage } from './src/storage/local.js';

process.env.COLONY_SUPABASE_URL = 'https://fake.supabase.co';
process.env.COLONY_SUPABASE_KEY = 'fake-key';
process.env.COLONY_SESSION_JWT = 'fake-jwt';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_KEY;

const claimRows = [
    {
        id: '123',
        agent_key_id: 'agent-a-uuid',
        agent_label: 'agent-alpha',
        task: 'feature/auth', // updated!
        files: ['src/auth/index.ts', 'src/auth/utils.ts'],
    },
    {
        id: '124',
        agent_key_id: 'agent-b-uuid',
        agent_label: 'agent-beta',
        task: 'feature/session', // updated!
        files: ['src/auth/session.ts', 'src/session/store.ts'],
    },
];

global.fetch = async (url) => {
    return new Response(JSON.stringify(claimRows), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};

const storage = new LocalStorage('./tmp-storage');
await storage.init();
const result = await syncFromColony();
console.log(result);
