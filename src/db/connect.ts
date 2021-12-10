import { knex, Knex } from "knex";

export const connect = (port: number, type: string, baseDir: string): Knex => {
  return knex({
    client: "sqlite3",
    connection: {
      filename: `${baseDir}/db-${type}-${port}.sqlite`,
    },
    useNullAsDefault: true,
    pool: {
      "min": 3,
      "max": 10,
      "createTimeoutMillis": 3000,
      "acquireTimeoutMillis": 30000,
      "idleTimeoutMillis": 30000,
      "reapIntervalMillis": 1000,
      "createRetryIntervalMillis": 100,
      "propagateCreateError": false
    },
  });
};
