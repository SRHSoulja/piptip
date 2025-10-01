-- Initialize test database with required extensions

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgcrypto for password hashing
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create test database if not exists (usually handled by POSTGRES_DB env var)
-- This file runs on container initialization

-- Set default timezone
SET timezone = 'UTC';

-- Log initialization
DO $$
BEGIN
  RAISE NOTICE 'PIPTip test database initialized successfully';
END $$;
