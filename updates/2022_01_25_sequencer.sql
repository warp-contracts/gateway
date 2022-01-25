ALTER TABLE interactions
    RENAME COLUMN bundled_in TO bundler_tx_id;

ALTER TABLE sequencer
    RENAME COLUMN bundled_tx_id TO bundler_tx_id;
