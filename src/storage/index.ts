// Branch storage adapters
export * from './adapter.js';
export * from './local.js';
export * from './supabase.js';
export * from './factory.js';

// Message storage adapters (tiered fallback)
export * from './message-adapter.js';
export * from './local-messages.js';
export * from './git-messages.js';
export * from './mycmail-adapter.js';
export * from './message-factory.js';
