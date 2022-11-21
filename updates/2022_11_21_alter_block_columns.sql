ALTER TABLE contracts
    ALTER COLUMN block_timestamp drop not null;

ALTER TABLE contracts
    ALTER COLUMN block_height drop not null;
