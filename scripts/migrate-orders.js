require('dotenv').config();
const { Client } = require('pg');

async function migrate() {
    const client = new Client({
        host: process.env.SUPABASE_DB_HOST,
        port: parseInt(process.env.SUPABASE_DB_PORT || '5432'),
        database: process.env.SUPABASE_DB_NAME,
        user: process.env.SUPABASE_DB_USER,
        password: process.env.SUPABASE_DB_PASSWORD,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('Conectando a la base de datos de Supabase...');
        await client.connect();
        console.log('Conexión exitosa.');

        // Alterar columna order_number a TEXT
        console.log('Modificando tipo de columna order_number a TEXT en la tabla orders...');
        await client.query('ALTER TABLE orders ALTER COLUMN order_number TYPE TEXT;');
        console.log('Migración completada exitosamente.');
    } catch (err) {
        console.error('Error durante la migración:', err);
    } finally {
        await client.end();
    }
}

migrate();
