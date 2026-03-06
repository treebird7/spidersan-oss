import { SupabaseStorage } from './src/storage/supabase.js';

async function run() {
    const storage = new SupabaseStorage({ url: "fake", key: "fake" });

    // We want to optimize pushRegistry which does a POST for each branch individually:
    // "Upsert each local branch into spider_registries with machine identity stamped"
    // Currently it does:
    // for (const b of branches) { ... await this.fetch(`spider_registries`, { method: 'POST', body: JSON.stringify(row) }) }

    // We can batch this! We just pass an array of rows to POST!
    // "body: JSON.stringify(rows)"
    console.log("PushRegistry currently loops and does 1 POST per branch. It should pass an array to POST once!");
}
run();
