const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function generateSitemap() {
    console.log("Iniciando generación de sitemap.xml...");
    
    // Configuración de la base de datos idéntica a api/index.js
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
        connection = await mysql.createConnection(dbConfig);
        console.log("Conectado a la base de datos MySQL.");

        // Obtener datos
        const [products] = await connection.query("SELECT id FROM products ORDER BY id DESC");
        const [categories] = await connection.query("SELECT id FROM categories");

        const baseUrl = process.env.DOMAIN_URL || 'https://emmastore.qzz.io';
        
        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

        // Home
        xml += `  <url>\n    <loc>${baseUrl}/</loc>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;

        // Categorías
        for (const cat of categories) {
            xml += `  <url>\n    <loc>${baseUrl}/?category=${cat.id}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
        }

        // Productos
        for (const prod of products) {
            xml += `  <url>\n    <loc>${baseUrl}/?product=${prod.id}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>\n`;
        }

        xml += `</urlset>`;

        // Escribir a public/sitemap.xml
        const sitemapPath = path.join(__dirname, '..', 'public', 'sitemap.xml');
        fs.writeFileSync(sitemapPath, xml, 'utf8');
        console.log(`Sitemap generado exitosamente en: ${sitemapPath}`);

    } catch (error) {
        console.error("Error generando el sitemap:", error);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

generateSitemap();
