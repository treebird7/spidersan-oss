-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================================================
-- KNOWLEDGE CHUNKS: Raw text/code snippets with embeddings
-- =============================================================================
CREATE TABLE knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Source info
  repo TEXT NOT NULL,              -- 'Spidersan', 'Watsan', etc.
  file_path TEXT NOT NULL,         -- 'src/commands/status.ts'
  section TEXT,                    -- 'Overview', 'Usage', etc.
  chunk_type TEXT NOT NULL,        -- 'markdown', 'code', 'comment'
  
  -- Content
  chunk_text TEXT NOT NULL,
  chunk_hash TEXT GENERATED ALWAYS AS (md5(chunk_text)) STORED,
  
  -- Embedding (OpenAI ada-002 or local)
  embedding VECTOR(1536),
  
  -- Metadata
  metadata JSONB DEFAULT '{}',     -- {language: 'ts', agent_id: 'spidersan'}
  sensitivity_level TEXT DEFAULT 'public',  -- 'public', 'internal', 'sensitive'
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Dedup
  UNIQUE(repo, file_path, chunk_hash)
);

-- Indexes
CREATE INDEX idx_chunks_embedding ON knowledge_chunks 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_chunks_repo ON knowledge_chunks(repo);
CREATE INDEX idx_chunks_text_search ON knowledge_chunks 
  USING gin (to_tsvector('english', chunk_text));

-- =============================================================================
-- RLS OBJECTS: Extracted logical structures (entities, relations, rules)
-- =============================================================================
CREATE TABLE rls_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id UUID REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
  
  -- RLS content (flexible JSON schema)
  rls_json JSONB NOT NULL,
  
  -- Provenance
  provenance JSONB DEFAULT '{}',   -- {commit: 'abc123', confidence: 0.92, model: 'llama3.1:8b'}
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rls_json ON rls_objects USING gin (rls_json);

-- =============================================================================
-- RLS NODES: Graph nodes for entities
-- =============================================================================
CREATE TABLE rls_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  name TEXT NOT NULL,              -- 'Spidersan', 'status', 'FormationWidget'
  node_type TEXT NOT NULL,         -- 'agent', 'command', 'function', 'file', 'concept'
  
  -- Link back
  rls_object_id UUID REFERENCES rls_objects(id) ON DELETE SET NULL,
  
  -- Attributes
  attributes JSONB DEFAULT '{}',   -- {description: '...', aliases: [...]}
  
  -- Agent scope
  agent_id TEXT,                   -- Owner agent or NULL for shared
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(name, node_type, agent_id)
);

CREATE INDEX idx_nodes_name ON rls_nodes(name);
CREATE INDEX idx_nodes_type ON rls_nodes(node_type);

-- =============================================================================
-- RLS EDGES: Graph edges for relations
-- =============================================================================
CREATE TABLE rls_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  source_id UUID REFERENCES rls_nodes(id) ON DELETE CASCADE,
  target_id UUID REFERENCES rls_nodes(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,     -- 'depends_on', 'implements', 'calls', 'collaborates_with'
  
  -- Link back
  rls_object_id UUID REFERENCES rls_objects(id) ON DELETE SET NULL,
  
  -- Cross-repo flag
  cross_repo BOOLEAN DEFAULT FALSE,
  
  -- Weights/confidence
  weight FLOAT DEFAULT 1.0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(source_id, target_id, relation_type)
);

CREATE INDEX idx_edges_source ON rls_edges(source_id);
CREATE INDEX idx_edges_target ON rls_edges(target_id);
CREATE INDEX idx_edges_type ON rls_edges(relation_type);

-- =============================================================================
-- WIKI PAGES: Auto-generated wiki articles
-- =============================================================================
CREATE TABLE wiki_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  title TEXT NOT NULL UNIQUE,
  title_slug TEXT GENERATED ALWAYS AS (lower(regexp_replace(title, '\s+', '-', 'g'))) STORED,
  
  -- Content
  content_md TEXT NOT NULL,
  summary TEXT,
  
  -- Links to source
  source_chunks UUID[] DEFAULT '{}',  -- Array of chunk IDs used
  source_nodes UUID[] DEFAULT '{}',   -- Array of node IDs featured
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wiki_slug ON wiki_pages(title_slug);
CREATE INDEX idx_wiki_search ON wiki_pages USING gin (to_tsvector('english', content_md));

-- =============================================================================
-- RLS POLICIES (Agent Isolation)
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE rls_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE rls_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE rls_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE wiki_pages ENABLE ROW LEVEL SECURITY;

-- KNOWLEDGE CHUNKS: Agents see public + their own sensitive data
CREATE POLICY "Chunks: public readable" ON knowledge_chunks
  FOR SELECT USING (sensitivity_level = 'public');

CREATE POLICY "Chunks: agent sees own" ON knowledge_chunks
  FOR SELECT USING (
    auth.jwt() ->> 'agent_id' = metadata ->> 'agent_id'
  );

CREATE POLICY "Chunks: agent inserts own" ON knowledge_chunks
  FOR INSERT WITH CHECK (
    auth.jwt() ->> 'agent_id' = metadata ->> 'agent_id'
  );

-- RLS NODES: Shared nodes public, scoped nodes per agent
CREATE POLICY "Nodes: shared readable" ON rls_nodes
  FOR SELECT USING (agent_id IS NULL);

CREATE POLICY "Nodes: agent sees own" ON rls_nodes
  FOR SELECT USING (agent_id = auth.jwt() ->> 'agent_id');

CREATE POLICY "Nodes: agent creates own" ON rls_nodes
  FOR INSERT WITH CHECK (
    agent_id IS NULL OR agent_id = auth.jwt() ->> 'agent_id'
  );

-- WIKI PAGES: Public readable, service role writable
CREATE POLICY "Wiki: public read" ON wiki_pages
  FOR SELECT USING (true);

CREATE POLICY "Wiki: service write" ON wiki_pages
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- Match Chunks (Vector Search)
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.78,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  repo TEXT,
  file_path TEXT,
  chunk_text TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.repo,
    kc.file_path,
    kc.chunk_text,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM knowledge_chunks kc
  WHERE 1 - (kc.embedding <=> query_embedding) > match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Get Subgraph
CREATE OR REPLACE FUNCTION get_rls_subgraph(
  start_entities TEXT[],
  max_hops INT DEFAULT 2
)
RETURNS TABLE (
  node_id UUID,
  node_name TEXT,
  node_type TEXT,
  edge_id UUID,
  relation_type TEXT,
  connected_to TEXT,
  hop INT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE graph AS (
    -- Start nodes
    SELECT 
      n.id AS node_id, n.name, n.node_type,
      NULL::UUID AS edge_id, NULL::TEXT AS relation_type, NULL::TEXT AS connected_to,
      0 AS hop
    FROM rls_nodes n
    WHERE n.name = ANY(start_entities)
    
    UNION ALL
    
    -- Traverse edges
    SELECT 
      n2.id, n2.name, n2.node_type,
      e.id, e.relation_type, g.name,
      g.hop + 1
    FROM graph g
    JOIN rls_edges e ON e.source_id = g.node_id OR e.target_id = g.node_id
    JOIN rls_nodes n2 ON (n2.id = e.target_id OR n2.id = e.source_id) AND n2.id != g.node_id
    WHERE g.hop < max_hops
  )
  SELECT DISTINCT * FROM graph;
END;
$$;
