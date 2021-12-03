import { knex, Knex } from "knex";

export const connect = (port: number, baseDir: string): Knex => {
  return knex({
    client: "sqlite3",
    connection: {
      filename: `${baseDir}/db-${port}.sqlite`,
    },
    useNullAsDefault: true,
  });
};
