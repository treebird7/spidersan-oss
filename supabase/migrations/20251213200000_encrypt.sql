-- Add encrypted column to agent_messages
ALTER TABLE public.agent_messages 
ADD COLUMN IF NOT EXISTS encrypted BOOLEAN DEFAULT false;

-- Add key_id column for future key rotation support
ALTER TABLE public.agent_messages 
ADD COLUMN IF NOT EXISTS key_id TEXT;

COMMENT ON COLUMN public.agent_messages.encrypted IS 'Whether the message content is encrypted';
COMMENT ON COLUMN public.agent_messages.key_id IS 'Key identifier used for encryption (for rotation)';

COMMIT;
