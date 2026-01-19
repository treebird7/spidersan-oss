-- RAG Knowledge System Schema
-- Watsan semantic search across Treebird ecosystem docs

-- Enable pgvector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Document chunks table
CREATE TABLE IF NOT EXISTS watsan_doc_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Content
    content TEXT NOT NULL,
    embedding VECTOR(1536),  -- OpenAI text-embedding-3-small dimensions
    
    -- Location
    file_path TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    heading TEXT,
    start_line INTEGER,
    end_line INTEGER,
    
    -- Metadata
    source TEXT DEFAULT 'manual',  -- 'manual' | 'mappersan' | 'spidersan'
    chunk_type TEXT DEFAULT 'doc',  -- 'doc' | 'function' | 'class' | 'branch' | 'session'
    project TEXT,                    -- Which project this belongs to
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint for upsert
    UNIQUE(file_path, chunk_index)
);

-- Track indexed files for change detection
CREATE TABLE IF NOT EXISTS watsan_indexed_files (
    file_path TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    indexed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Similarity search function
CREATE OR REPLACE FUNCTION watsan_match_documents(
    query_embedding VECTOR(1536),
    match_count INT DEFAULT 5,
    match_threshold FLOAT DEFAULT 0.5,
    filter_project TEXT DEFAULT NULL,
    filter_type TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    file_path TEXT,
    heading TEXT,
    chunk_type TEXT,
    start_line INTEGER,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        dc.id,
        dc.content,
        dc.file_path,
        dc.heading,
        dc.chunk_type,
        dc.start_line,
        1 - (dc.embedding <=> query_embedding) AS similarity
    FROM watsan_doc_chunks dc
    WHERE 
        dc.embedding IS NOT NULL
        AND 1 - (dc.embedding <=> query_embedding) > match_threshold
        AND (filter_project IS NULL OR dc.project = filter_project)
        AND (filter_type IS NULL OR dc.chunk_type = filter_type)
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_watsan_chunks_embedding 
    ON watsan_doc_chunks 
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_watsan_chunks_file_path 
    ON watsan_doc_chunks(file_path);

CREATE INDEX IF NOT EXISTS idx_watsan_chunks_project 
    ON watsan_doc_chunks(project);

CREATE INDEX IF NOT EXISTS idx_watsan_chunks_type 
    ON watsan_doc_chunks(chunk_type);

-- RLS policies (enable for security)
ALTER TABLE watsan_doc_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE watsan_indexed_files ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users (anon key)
CREATE POLICY IF NOT EXISTS "Allow all for anon" ON watsan_doc_chunks
    FOR ALL USING (true);

CREATE POLICY IF NOT EXISTS "Allow all for anon" ON watsan_indexed_files
    FOR ALL USING (true);
