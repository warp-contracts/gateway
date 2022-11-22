ALTER TABLE contracts
    ALTER COLUMN block_timestamp set not null;

ALTER TABLE contracts
    ALTER COLUMN block_height set not null;
