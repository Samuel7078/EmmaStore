require('dotenv').config();
const mysql = require('mysql2/promise');
const { createClient } = require('@supabase/supabase-js');

async function testConnections() {
    console.log("--- TEST DE VARIABLES DE ENTORNO Y CONEXIONES ---");
    let hasErrors = false;

    // 1. Test MySQL
    console.log("1. Probando conexión a MySQL...");
    const dbConfig = {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: parseInt(process.env.DB_PORT || '3306'),
        ssl: { rejectUnauthorized: false }
    };
    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.query("SELECT 1");
        console.log("   ✅ MySQL Conectado correctamente.");
        await connection.end();
    } catch (err) {
        console.error("   ❌ Error conectando a MySQL:", err.message);
        hasErrors = true;
    }

    // 2. Test Supabase
    console.log("\n2. Probando Supabase URL y Keys...");
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error("   ❌ Faltan variables de Supabase en el .env");
        hasErrors = true;
    } else {
        try {
            const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
            const { data, error } = await supabaseAdmin.from('addresses').select('id').limit(1);
            if (error) {
                console.error("   ❌ Error en consulta a Supabase:", error.message);
                hasErrors = true;
            } else {
                console.log("   ✅ Supabase Conectado correctamente.");
            }
        } catch (err) {
            console.error("   ❌ Error de inicialización Supabase:", err.message);
            hasErrors = true;
        }
    }

    // 3. Test Cloudinary
    console.log("\n3. Validando Cloudinary...");
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        console.error("   ❌ Faltan variables de Cloudinary en el .env");
        hasErrors = true;
    } else {
        console.log("   ✅ Cloudinary variables presentes.");
    }

    // 4. Test Gmail
    console.log("\n4. Validando Gmail...");
    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
        console.error("   ❌ Faltan variables GMAIL_USER o GMAIL_PASS");
        hasErrors = true;
    } else {
        console.log("   ✅ Variables Gmail principal presentes.");
    }

    if (hasErrors) {
        console.log("\n⚠️ Se encontraron problemas con las variables de entorno.");
    } else {
        console.log("\n🎉 Todas las variables base y conexiones funcionan correctamente.");
    }
}

testConnections();
