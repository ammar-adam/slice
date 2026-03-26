-- Slice: required database extensions
-- Order: 00000000000000

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA extensions;

COMMENT ON EXTENSION pgcrypto IS 'gen_random_uuid() and cryptographic helpers';

COMMENT ON EXTENSION pg_trgm IS 'Restaurant name search helpers for rankings UI';
