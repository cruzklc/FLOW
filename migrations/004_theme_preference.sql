-- Add theme_preference column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(50) DEFAULT 'violet';
