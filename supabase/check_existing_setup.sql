-- Read-only check of the existing MyPurePlan Supabase setup.
-- This query does not create, alter, or delete anything.
WITH required_tables(table_name) AS (
  VALUES
    ('businesses'), ('business_members'), ('customers'), ('customer_addresses'),
    ('services'), ('recurrence_rules'), ('appointments'), ('availability_rules'),
    ('blocked_periods'), ('payments'), ('notifications'), ('integrations')
), table_check AS (
  SELECT
    'table'::text AS object_type,
    r.table_name AS object_name,
    (c.oid IS NOT NULL)::text AS object_exists,
    COALESCE(c.relrowsecurity, false)::text AS rls_enabled,
    COUNT(p.policyname)::text AS policy_count
  FROM required_tables r
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = r.table_name AND c.relkind = 'r'
  LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = r.table_name
  GROUP BY r.table_name, c.oid, c.relrowsecurity
)
SELECT * FROM table_check
UNION ALL
SELECT 'enum', 'appointment_status', EXISTS (
  SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typname = 'appointment_status' AND t.typtype = 'e'
)::text, '-', '-'
UNION ALL
SELECT 'enum', 'member_role', EXISTS (
  SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typname = 'member_role' AND t.typtype = 'e'
)::text, '-', '-'
UNION ALL
SELECT 'function', 'create_business_for_current_user', EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_business_for_current_user'
)::text, '-', '-'
ORDER BY object_type, object_name;
