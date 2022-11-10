ALTER TABLE interactions ADD COLUMN owner text;
UPDATE interactions SET owner = interaction->'owner'->>'address';

