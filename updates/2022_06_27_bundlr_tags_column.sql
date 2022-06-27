ALTER TABLE contracts
    ADD COLUMN bundler_contract_tags jsonb;

CREATE INDEX contracts_bundler_contract_tags
    ON contracts (bundler_contract_tags);
    