import {Knex} from "knex";

export type INTERACTIONS_TABLE = {
  interaction_id: string;
  interaction: string;
  block_height: number;
  block_id: string;
  contract_id: string;
  function: string;
  input: string;
  confirmation_status: string;
};


export async function initGatewayDb(db: Knex) {
  if (!(await db.schema.hasTable("interactions"))) {
    await db.schema.createTable("interactions", (table) => {
      table.increments("id").primary();
      table.string("interaction_id", 64).notNullable().index();
      table.json("interaction").notNullable();
      table.bigInteger("block_height").notNullable().index();
      table.string("block_id").notNullable();
      table.string("contract_id").notNullable().index();
      table.string("function").index();
      table.jsonb("input").notNullable();
      table
        .string("confirmation_status")
        .index()
        .notNullable()
        // TODO: add constraint for allowed values
        // not_processed | orphaned | confirmed | forked
        .defaultTo("not_processed");
      table.string("confirming_peer");
      table.bigInteger("confirmed_at_height");
      table.bigInteger("confirmations");
      table.index(['contract_id', 'block_height'], 'contract_id_block_height_index');
    });
  }

  if (!(await db.schema.hasTable("peers"))) {
    await db.schema.createTable("peers", (table) => {
      table.string("peer", 64).primary();
      table.bigInteger("blocks").notNullable();
      table.bigInteger("height").notNullable();
      table.bigInteger("response_time").notNullable();
      table.boolean("blacklisted").notNullable().defaultTo("false");
    });
  }
}
