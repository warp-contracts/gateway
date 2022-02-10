-- auto-generated definition
create table interactions
(
    source              varchar(255) default 'arweave'::character varying not null,
    bundler_tx_id       varchar(255) default NULL::character varying,
    block_id            varchar(255)                                      not null,
    interaction_id      varchar(255)                                      not null,
    function            varchar(255),
    input               text,
    confirmations       varchar(255),
    confirmed_at_height bigint,
    confirming_peer     varchar(255),
    confirmation_status varchar(255)                                      not null,
    contract_id         varchar(255)                                      not null,
    block_height        integer                                           not null,
    interaction         jsonb                                             not null,
    id                  serial
        constraint interactions_pk
            primary key
);

alter table interactions
    owner to postgres;

create unique index interactions_interaction_id_uindex
    on interactions (interaction_id);

create index interactions_contract_id_index
    on interactions (contract_id);

create index interactions_confirmation_status_index
    on interactions (confirmation_status);

create index interactions_block_height_index
    on interactions (block_height);

create index idx_interactions_contract_status_height
    on interactions (contract_id asc, confirmation_status asc, block_height desc);

create index interactions_block_height_interaction_id_index
    on interactions (block_height desc, interaction_id desc);

CREATE EXTENSION pg_trgm;

create index idx_interaction_id_gin
    on interactions using gin (interaction_id gin_trgm_ops);

create index interactions_source_index
    on interactions (source);

