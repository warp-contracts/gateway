import {knex, Knex} from 'knex';

export const connect = (): Knex => {
    const config = getConfig();
    return knex(config);
};

function getConfig(): Knex.Config {
    let config: Knex.Config = {
        client: 'pg',
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
    };
    if (process.env.DB_USER) {
        config.connection = {
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            port: process.env.DB_PORT && parseInt(process.env.DB_PORT) || 5432,
            database: process.env.DB_NAME || 'postgres',
        };
    } else {
        config.connection = process.env.DB_URL;
    }
    if (!config.connection) {
        throw new Error('Database connection settings not specified')
    }
    return config;
}
