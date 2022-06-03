ALTER TABLE interactions
    ADD COLUMN evolve varchar(64);

CREATE INDEX evolve_index
    ON interactions (evolve);