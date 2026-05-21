-- Add binary recording storage to interviews table
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS recording_data BYTEA;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS recording_mime TEXT DEFAULT 'audio/webm';
