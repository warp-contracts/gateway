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
  interact_write: string[];
};

export async function initGatewayDb(db: Knex) {
  if (!(await db.schema.hasTable("interactions"))) {
    await db.schema.createTable("interactions", (table) => {
      table.increments("id").primary();
      table.string("interaction_id", 64).notNullable().unique().index();
      table.jsonb("interaction").notNullable();
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
        // not_processed | corrupted | confirmed | forked
        .defaultTo("not_processed");
      table.string("confirming_peer");
      table.integer("confirmed_at_height");
      table.string("confirmations");
      table.index(['contract_id', 'confirmation_status', 'block_height'], 'contract_id_block_height_confirmations_status_index');
      table.index(['contract_id', 'block_height'], 'contract_id_block_height_index');
      table.index(['block_height desc', 'interaction_id desc'], 'block_height_interaction_id_index');
    });
  }

  if (!(await db.schema.hasTable("peers"))) {
    await db.schema.createTable("peers", (table) => {
      table.string("peer", 64).primary();
      table.integer("blocks").notNullable().index();
      table.integer("height").notNullable();
      table.integer("response_time").notNullable().index();
      table.boolean("blacklisted").notNullable().defaultTo("false");
    });
  }

  if (!(await db.schema.hasTable("contracts"))) {
    await db.schema.createTable("contracts", (table) => {
      table.string("contract_id", 64).primary();
      table.string("src_tx_id", 64).index();
      table.text("src");
      table.jsonb("init_state");
      table.string("owner", 64).index();
      // pst | other
      table.string("type", 64).index();
      // eg: kyve, koi, pianity, redstone, verto...
      table.string("project", 64).index();
    });
  }
}
