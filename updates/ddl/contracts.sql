-- auto-generated definition
create table contracts
(
    contract_id  varchar(64) not null
        constraint contracts_pkey
            primary key,
    src_tx_id    varchar(64),
    src          text,
    init_state   jsonb,
    owner        varchar(64),
    type         varchar(64),
    project      varchar(64),
    pst_ticker   text,
    pst_name     text,
    block_height integer,
    content_type varchar(255) default 'application/json'::character varying
);

alter table contracts
    owner to postgres;

create index contracts_src_tx_id_index
    on contracts (src_tx_id);

create index contracts_owner_index
    on contracts (owner);

create index contracts_type_index
    on contracts (type);

create index contracts_project_index
    on contracts (project);

create index contracts_pst_name_index
    on contracts (pst_name);

create index contracts_pst_ticker_index
    on contracts (pst_ticker);

