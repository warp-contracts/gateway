-- auto-generated definition
create table peers
(
    response_time integer,
    height        integer,
    blocks        integer,
    peer          varchar(255) not null
        constraint peers_1_pk
            primary key,
    blacklisted   boolean
);

alter table peers
    owner to postgres;

create index peers_1_response_time_index
    on peers (response_time);

