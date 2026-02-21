-- ============================================================
-- PASTE THIS INTO SUPABASE SQL EDITOR
-- Table already exists — this just fixes policies + views
-- ============================================================

DROP POLICY IF EXISTS "Anyone can read all registries" ON spider_registries;
DROP POLICY IF EXISTS "Insert own machine registries" ON spider_registries;
DROP POLICY IF EXISTS "Update own machine registries" ON spider_registries;
DROP POLICY IF EXISTS "Delete own machine registries" ON spider_registries;

CREATE POLICY "Anyone can read all registries" ON spider_registries FOR SELECT USING (true);
CREATE POLICY "Insert own machine registries" ON spider_registries FOR INSERT WITH CHECK (true);
CREATE POLICY "Update own machine registries" ON spider_registries FOR UPDATE USING (true);
CREATE POLICY "Delete own machine registries" ON spider_registries FOR DELETE USING (true);

CREATE OR REPLACE VIEW spider_active_registries AS
SELECT * FROM spider_registries WHERE status = 'active' ORDER BY synced_at DESC;

CREATE OR REPLACE VIEW spider_file_overlaps AS
SELECT r1.repo_name, unnest(r1.files) AS file_path,
    r1.branch_name AS branch_a, r1.machine_name AS machine_a,
    r2.branch_name AS branch_b, r2.machine_name AS machine_b
FROM spider_registries r1
JOIN spider_registries r2
    ON r1.repo_name = r2.repo_name AND r1.id < r2.id
    AND r1.status = 'active' AND r2.status = 'active'
WHERE r1.files && r2.files;
