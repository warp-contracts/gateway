import { knex, Knex } from 'knex';

export const connect = (): Knex => {
  return knex({
    client: 'pg',
    connection: process.env.DB_URL,
    useNullAsDefault: true,
    pool: {
      min: 5,
      max: 30,
      createTimeoutMillis: 3000,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 100,
      propagateCreateError: false,
    },
  });
};
