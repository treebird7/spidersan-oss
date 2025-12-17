-- Migration: Agent Messaging System
-- Date: 2025-12-11
-- Purpose: Enable cross-agent communication via Supabase

-- Agent messages table
CREATE TABLE IF NOT EXISTS agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Routing
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  from_repo TEXT,
  to_repo TEXT,
  
  -- Message content
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  message_type TEXT DEFAULT 'info'
    CHECK (message_type IN ('info', 'question', 'alert', 'handoff', 'file_share')),
  
  -- Context
  branch_name TEXT,
  related_files TEXT[],
  
  -- File sharing
  attached_files JSONB,
  
  -- Status
  read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  replied_to UUID REFERENCES agent_messages(id),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agent_messages_to ON agent_messages(to_agent, read);
CREATE INDEX IF NOT EXISTS idx_agent_messages_from ON agent_messages(from_agent);
CREATE INDEX IF NOT EXISTS idx_agent_messages_created ON agent_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_messages_type ON agent_messages(message_type);

-- View: Unread messages
CREATE OR REPLACE VIEW unread_agent_messages AS
SELECT * FROM agent_messages
WHERE read = false
ORDER BY created_at DESC;

-- View: Recent file shares
CREATE OR REPLACE VIEW recent_file_shares AS
SELECT * FROM agent_messages
WHERE message_type = 'file_share'
  AND attached_files IS NOT NULL
ORDER BY created_at DESC
LIMIT 50;

-- Function: Mark message as read
CREATE OR REPLACE FUNCTION mark_message_read(message_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE agent_messages
  SET read = true, read_at = NOW()
  WHERE id = message_id;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- RLS (optional - adjust as needed)
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_messages_all ON agent_messages;
CREATE POLICY agent_messages_all ON agent_messages
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Comment
COMMENT ON TABLE agent_messages IS 'Cross-agent messaging system for coordinating work across repos';
