require('dotenv').config();
const mysql = require('mysql2/promise');
const { createClient } = require('@supabase/supabase-js');

async function wipeTestData() {
    console.log("--- INICIANDO LIMPIEZA DE DATOS DE PRUEBA ---");
    let hasErrors = false;

    // 1. Conexión a MySQL para vaciar 'logs'
    const dbConfig = {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: parseInt(process.env.DB_PORT || '3306'),
        ssl: { rejectUnauthorized: false }
    };
    
    let connection;
    try {
        console.log("1. Conectando a MySQL...");
        connection = await mysql.createConnection(dbConfig);
        console.log("   Vaciando tabla 'logs'...");
        await connection.query("TRUNCATE TABLE logs");
        console.log("   ✅ Tabla 'logs' vaciada exitosamente.");
    } catch (err) {
        console.error("   ❌ Error vaciando 'logs':", err.message);
        hasErrors = true;
    } finally {
        if (connection) await connection.end();
    }

    // 2. Conexión a Supabase para vaciar 'order_items' y 'orders'
    console.log("\n2. Conectando a Supabase...");
    try {
        const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        
        // Primero eliminamos los order_items por la relación de llave foránea
        console.log("   Eliminando 'order_items'...");
        const { error: itemsError } = await supabaseAdmin
            .from('order_items')
            .delete()
            .neq('id', 0); // Esto elimina todo

        if (itemsError) throw itemsError;
        console.log("   ✅ Detalles de pedidos (order_items) eliminados.");

        console.log("   Eliminando 'orders'...");
        const { error: ordersError } = await supabaseAdmin
            .from('orders')
            .delete()
            .neq('id', 0); // Esto elimina todo

        if (ordersError) throw ordersError;
        console.log("   ✅ Pedidos (orders) eliminados exitosamente.");

    } catch (err) {
        console.error("   ❌ Error limpiando pedidos en Supabase:", err.message);
        hasErrors = true;
    }

    if (hasErrors) {
        console.log("\n⚠️ Ocurrieron algunos errores durante la limpieza.");
    } else {
        console.log("\n🎉 LIMPIEZA COMPLETADA CON ÉXITO. Sistema listo para producción.");
    }
}

wipeTestData();
