import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    port: parseInt(process.env.DB_PORT || '5432', 10)
};

export const pools = {
    orders: new Pool({
        ...dbConfig,
        database: 'ordering'
    }),
    clients: new Pool({
        ...dbConfig,
        database: 'clients'
    })
};

export const pool = new Pool({
    ...dbConfig,
    database: 'Rooming'
});

// Error handler for unexpected pool errors
pool.on('error', (err: Error) => {
    console.error('Unexpected error on idle client', err);
});

// Test connection
pool.query('SELECT NOW()')
    .then(() => console.log('Database connected successfully'))
    .catch(err => console.error('Database connection failed:', err)); 