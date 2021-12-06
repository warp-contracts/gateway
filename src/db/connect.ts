import { knex, Knex } from "knex";

export const connect = (port: number, type: string, baseDir: string): Knex => {
  return knex({
    client: "sqlite3",
    connection: {
      filename: `${baseDir}/db-${type}-${port}.sqlite`,
    },
    useNullAsDefault: true,
  });
};
