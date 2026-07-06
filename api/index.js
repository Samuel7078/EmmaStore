const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(cors());

// Límites ampliados para soportar múltiples Base64 de alta resolución
app.use(express.json({ limit: '100mb' })); 
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// --- CONFIGURACIÓN CLOUDINARY ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// --- CONFIGURACIÓN MYSQL (Productos, Categorías, Contactos, Stories, Logs) ---
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT),
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10
};

const pool = mysql.createPool(dbConfig);

// --- CONFIGURACIÓN SUPABASE (Usuarios, Pedidos, Direcciones) ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// --- HELPERS: CONFIGURACIÓN DE CORREOS ---
async function initEmailSettings() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS email_settings (
            id INT PRIMARY KEY DEFAULT 1,
            active_client_method VARCHAR(20) DEFAULT 'gmail2',
            count_admin_daily INT DEFAULT 0,
            count_gmail2_daily INT DEFAULT 0,
            count_sendpulse_total INT DEFAULT 0,
            last_reset_date DATE
        )
    `);
    const [rows] = await pool.query("SELECT * FROM email_settings WHERE id = 1");
    if (rows.length === 0) {
        await pool.query("INSERT INTO email_settings (id, last_reset_date) VALUES (1, CURDATE())");
    } else {
        await pool.query(`
            UPDATE email_settings 
            SET count_admin_daily = 0, count_gmail2_daily = 0, last_reset_date = CURDATE()
            WHERE id = 1 AND (last_reset_date IS NULL OR last_reset_date < CURDATE())
        `);
    }
}

async function getEmailConfig() {
    await initEmailSettings();
    const [rows] = await pool.query("SELECT * FROM email_settings WHERE id = 1");
    return rows[0];
}

async function incrementEmailCount(type) {
    await initEmailSettings();
    if (type === 'admin') {
        await pool.query("UPDATE email_settings SET count_admin_daily = count_admin_daily + 1 WHERE id = 1");
    } else if (type === 'gmail2') {
        await pool.query("UPDATE email_settings SET count_gmail2_daily = count_gmail2_daily + 1 WHERE id = 1");
    } else if (type === 'sendpulse') {
        await pool.query("UPDATE email_settings SET count_sendpulse_total = count_sendpulse_total + 1 WHERE id = 1");
    }
}

// --- HELPERS: IMÁGENES Y SEGURIDAD ---

async function uploadToCloudinary(images, folder) {
    const urls = [];
    if (!images || !Array.isArray(images)) return urls;

    for (const img of images) {
        if (!img) continue;
        
        // Si ya es una URL de Cloudinary (ej. al editar), la mantenemos
        if (typeof img === 'string' && img.startsWith('http')) {
            urls.push(img);
            continue;
        }
        
        try {
            const res = await cloudinary.uploader.upload(img, {
                folder: folder,
                format: 'webp',
                transformation: [{ quality: 'auto', fetch_format: 'auto' }]
            });
            urls.push(res.secure_url);
        } catch (error) {
            console.error(`Error en Cloudinary (${folder}):`, error);
            throw new Error("Fallo en la subida a Cloudinary");
        }
    }
    return urls;
}

async function createLog(action, detail) {
    try {
        const timestamp = new Date().toLocaleString('es-BO', { timeZone: 'America/La_Paz' });
        const rawTime = Date.now();
        await pool.execute(
            "INSERT INTO logs (action, detail, ip, timestamp, rawTime) VALUES (?, ?, ?, ?, ?)",
            [action, detail, 'ADMIN_PANEL', timestamp, rawTime]
        );
    } catch (err) { console.error("Error al crear log:", err); }
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

// --- MIDDLEWARE: Autenticación Supabase ---
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: "No autorizado" });
    }
    const token = authHeader.replace('Bearer ', '');
    try {
        const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !user) {
            return res.status(401).json({ error: "Token inválido" });
        }
        req.user = user;
        next();
    } catch (err) {
        return res.status(401).json({ error: "Error de autenticación" });
    }
}

// =============================================
// ENDPOINTS MYSQL (Productos, Categorías, etc.)
// =============================================

// --- ENDPOINTS DE SEGURIDAD ---

app.post('/api/login', async (req, res) => {
    const { password } = req.body;
    try {
        const [rows] = await pool.query("SELECT password FROM admin_user WHERE username = 'admin'");
        if (rows.length === 0) return res.status(404).json({ error: "Admin no configurado" });

        const [salt, storedHash] = rows[0].password.trim().split(':');
        const hashToVerify = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');

        if (storedHash === hashToVerify) {
            const sessionToken = crypto.randomBytes(32).toString('hex');
            res.json({ success: true, token: sessionToken });
        } else {
            res.status(401).json({ error: "Contraseña incorrecta" });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/config', (req, res) => {
    res.json({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY
    });
});

app.get('/api/admin/email-settings', async (req, res) => {
    try {
        const config = await getEmailConfig();
        res.json({
            config,
            env: {
                gmailAdmin: process.env.GMAIL_USER || 'No configurado',
                gmail2: process.env.GMAIL_USER_2 || 'No configurado',
                sendpulseSender: process.env.SENDPULSE_SENDER_EMAIL || process.env.GMAIL_USER_2 || 'pedidos@emmastore.com'
            }
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/email-settings', async (req, res) => {
    try {
        const { active_client_method } = req.body;
        if (active_client_method !== 'sendpulse' && active_client_method !== 'gmail2') {
            return res.status(400).json({ error: "Método inválido" });
        }
        await initEmailSettings();
        await pool.query("UPDATE email_settings SET active_client_method = ? WHERE id = 1", [active_client_method]);
        res.json({ success: true, method: active_client_method });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/update-password', async (req, res) => {
    const { newPassword } = req.body;
    try {
        const newHashedValue = hashPassword(newPassword);
        await pool.execute("UPDATE admin_user SET password = ? WHERE username = 'admin'", [newHashedValue]);
        await createLog("SEGURIDAD", "Cambio de contraseña maestra");
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ENDPOINTS DE CORREOS DE ADMINISTRADORES ---

app.get('/api/admin/emails', async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT * FROM admin_emails ORDER BY id DESC");
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/emails', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: "Email is required" });
        await pool.execute("INSERT INTO admin_emails (email) VALUES (?)", [email]);
        await createLog("EMAIL_ADMIN", `Agregado correo: ${email}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/emails/:id', async (req, res) => {
    try {
        await pool.execute("DELETE FROM admin_emails WHERE id = ?", [req.params.id]);
        await createLog("EMAIL_ADMIN", `Eliminado correo ID: ${req.params.id}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- DYNAMIC SITEMAP ENDPOINT ---
app.get('/sitemap.xml', async (req, res) => {
    try {
        const host = req.headers.host || 'emmastore.qzz.io';
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const baseUrl = `${protocol}://${host}`;

        // Query MySQL products & categories
        const [products] = await pool.query("SELECT id FROM products ORDER BY id DESC");
        const [categories] = await pool.query("SELECT id FROM categories");

        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

        const today = new Date().toISOString().split('T')[0];

        // Home
        xml += `  <url>\n    <loc>${baseUrl}/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;

        // Categorías
        for (const cat of categories) {
            xml += `  <url>\n    <loc>${baseUrl}/?category=${cat.id}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
        }

        // Productos
        for (const prod of products) {
            xml += `  <url>\n    <loc>${baseUrl}/?product=${prod.id}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>\n`;
        }

        xml += `</urlset>`;

        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (error) {
        console.error("Error generating sitemap dynamically:", error);
        res.status(500).send("Error generating sitemap");
    }
});

// --- DYNAMIC ROBOTS.TXT ENDPOINT ---
app.get('/robots.txt', (req, res) => {
    try {
        const host = req.headers.host || 'emmastore.qzz.io';
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const baseUrl = `${protocol}://${host}`;

        res.type('text/plain');
        res.send(`User-agent: *\nAllow: /\n\nSitemap: ${baseUrl}/sitemap.xml\n`);
    } catch (error) {
        console.error("Error generating robots.txt dynamically:", error);
        res.status(500).send("Error generating robots.txt");
    }
});


// --- ENDPOINTS DE PRODUCTOS ---

app.get('/api/products', async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT * FROM products ORDER BY id DESC");
        res.json(rows.map(p => ({ ...p, images: JSON.parse(p.images || "[]") })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/products', async (req, res) => {
    const { name, price, description, images, categoryId, contactId, whatsappCustomMsg } = req.body;
    try {
        const cloudinaryUrls = await uploadToCloudinary(images, 'products');
        
        const values = [
            name || null,
            price || 0,
            description || null,
            JSON.stringify(cloudinaryUrls),
            categoryId || null,
            contactId || null,
            whatsappCustomMsg || ""
        ];

        const sql = "INSERT INTO products (name, price, description, images, categoryId, contactId, whatsappCustomMsg) VALUES (?,?,?,?,?,?,?)";
        await pool.execute(sql, values);
        
        await createLog("CREAR_PRODUCTO", `Producto: ${name}`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/products/:id', async (req, res) => {
    const { name, price, description, images, categoryId, contactId, whatsappCustomMsg } = req.body;
    try {
        // CORRECCIÓN: Se usa la función helper correcta
        const cloudinaryUrls = await uploadToCloudinary(images, 'products');
        
        const sql = "UPDATE products SET name=?, price=?, description=?, images=?, categoryId=?, contactId=?, whatsappCustomMsg=? WHERE id=?";
        await pool.execute(sql, [name, price, description, JSON.stringify(cloudinaryUrls), categoryId, contactId, whatsappCustomMsg, req.params.id]);
        
        await createLog("EDITAR_PRODUCTO", `ID: ${req.params.id}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ENDPOINTS DE CATEGORÍAS Y EQUIPO ---

app.get('/api/categories', async (req, res) => {
    try { const [rows] = await pool.query("SELECT * FROM categories"); res.json(rows); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/categories', async (req, res) => {
    try {
        await pool.execute("INSERT INTO categories (name) VALUES (?)", [req.body.name]);
        await createLog("CATEGORIA", req.body.name);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/categories/:id/assign-products', async (req, res) => {
    try {
        const categoryId = req.params.id;
        const { productIds } = req.body;
        
        // Primero, limpiamos la asignación actual de esta categoría
        await pool.execute("UPDATE products SET categoryId = NULL WHERE categoryId = ?", [categoryId]);
        
        // Luego asignamos los productos seleccionados
        if (productIds && productIds.length > 0) {
            await pool.query("UPDATE products SET categoryId = ? WHERE id IN (?)", [categoryId, productIds]);
        }
        
        await createLog("ASIGNAR_CATEGORIA", `Asignación masiva a la categoría ID: ${categoryId}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contacts', async (req, res) => {
    try { const [rows] = await pool.query("SELECT * FROM contacts"); res.json(rows); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/contacts', async (req, res) => {
    try {
        await pool.execute("INSERT INTO contacts (name, number) VALUES (?, ?)", [req.body.name, req.body.number]);
        await createLog("VENDEDOR", req.body.name);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/contacts/:id/assign-products', async (req, res) => {
    try {
        const contactId = req.params.id;
        const { productIds } = req.body;
        
        // Primero, limpiamos la asignación actual de este vendedor
        await pool.execute("UPDATE products SET contactId = NULL WHERE contactId = ?", [contactId]);
        
        // Luego asignamos los productos seleccionados
        if (productIds && productIds.length > 0) {
            await pool.query("UPDATE products SET contactId = ? WHERE id IN (?)", [contactId, productIds]);
        }
        
        await createLog("ASIGNAR_EQUIPO", `Asignación masiva al contacto ID: ${contactId}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- PROMOTIONS (MISMOS DATOS QUE PRODUCTOS + DURACIÓN Y EXPIRACIÓN) ---

async function initPromotions() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS promotions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            price DECIMAL(10,2) DEFAULT 0.00,
            description TEXT,
            images TEXT, -- JSON array of Cloudinary URLs
            categoryId INT,
            contactId INT,
            whatsappCustomMsg TEXT,
            duration_type VARCHAR(20) NOT NULL,
            duration_val VARCHAR(50) NOT NULL,
            endsAt BIGINT NOT NULL,
            createdAt BIGINT NOT NULL
        )
    `);
}

app.get('/api/promotions', async (req, res) => {
    try {
        await initPromotions();
        const [rows] = await pool.query("SELECT * FROM promotions ORDER BY id DESC");
        res.json(rows.map(p => ({ 
            ...p, 
            images: JSON.parse(p.images || "[]"),
            price: parseFloat(p.price) || 0
        })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/promotions', async (req, res) => {
    const { name, price, description, images, categoryId, contactId, whatsappCustomMsg, durationType, durationVal, endsAt } = req.body;
    try {
        await initPromotions();
        const cloudinaryUrls = await uploadToCloudinary(images, 'promotions');
        
        const calculatedEndsAt = endsAt ? parseFloat(endsAt) : (durationType === 'hours' 
            ? Date.now() + parseFloat(durationVal) * 60 * 60 * 1000 
            : new Date(durationVal).getTime());

        const values = [
            name || null,
            price || 0,
            description || null,
            JSON.stringify(cloudinaryUrls),
            categoryId || null,
            contactId || null,
            whatsappCustomMsg || "",
            durationType || 'hours',
            durationVal || '0',
            calculatedEndsAt,
            Date.now()
        ];

        const sql = "INSERT INTO promotions (name, price, description, images, categoryId, contactId, whatsappCustomMsg, duration_type, duration_val, endsAt, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)";
        await pool.execute(sql, values);
        
        await createLog("PROMO", `Creada promoción: ${name}`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/promotions/:id', async (req, res) => {
    const { name, price, description, images, categoryId, contactId, whatsappCustomMsg, durationType, durationVal, endsAt } = req.body;
    try {
        await initPromotions();
        const cloudinaryUrls = await uploadToCloudinary(images, 'promotions');
        
        const calculatedEndsAt = endsAt ? parseFloat(endsAt) : (durationType === 'hours' 
            ? Date.now() + parseFloat(durationVal) * 60 * 60 * 1000 
            : new Date(durationVal).getTime());

        const sql = "UPDATE promotions SET name=?, price=?, description=?, images=?, categoryId=?, contactId=?, whatsappCustomMsg=?, duration_type=?, duration_val=?, endsAt=? WHERE id=?";
        await pool.execute(sql, [
            name,
            price || 0,
            description || null,
            JSON.stringify(cloudinaryUrls),
            categoryId || null,
            contactId || null,
            whatsappCustomMsg || "",
            durationType,
            durationVal,
            calculatedEndsAt,
            req.params.id
        ]);
        
        await createLog("EDITAR_PROMO", `ID: ${req.params.id}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- HISTORIAL Y BORRADO ---

app.get('/api/logs', async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT * FROM logs ORDER BY rawTime DESC LIMIT 100");
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/:table/:id', async (req, res) => {
    try {
        const allowed = ['products', 'categories', 'contacts', 'promotions'];
        if (!allowed.includes(req.params.table)) return res.status(400).send("No permitido");
        await pool.execute(`DELETE FROM ${req.params.table} WHERE id = ?`, [req.params.id]);
        await createLog("ELIMINAR", `${req.params.table} ID: ${req.params.id}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// =============================================
// ENDPOINTS SUPABASE (Usuarios, Pedidos, Direcciones)
// =============================================

// --- PERFIL DEL USUARIO ---

app.get('/api/user/profile', requireAuth, async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', req.user.id)
            .single();
        
        if (error) return res.status(404).json({ error: "Perfil no encontrado" });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/user/profile', requireAuth, async (req, res) => {
    try {
        const { full_name, phone } = req.body;
        const { data, error } = await supabaseAdmin
            .from('profiles')
            .update({ full_name, phone })
            .eq('id', req.user.id)
            .select()
            .single();
        
        if (error) return res.status(400).json({ error: error.message });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- DIRECCIONES DEL USUARIO ---

app.get('/api/user/addresses', requireAuth, async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('addresses')
            .select('*')
            .eq('user_id', req.user.id)
            .order('is_default', { ascending: false })
            .order('created_at', { ascending: false });
        
        if (error) return res.status(400).json({ error: error.message });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/user/addresses', requireAuth, async (req, res) => {
    try {
        const { label, street, apartment, city, department, country, maps_link, door_description, is_default } = req.body;
        
        // Si es default, quitar default de las demás
        if (is_default) {
            await supabaseAdmin
                .from('addresses')
                .update({ is_default: false })
                .eq('user_id', req.user.id);
        }
        
        const { data, error } = await supabaseAdmin
            .from('addresses')
            .insert({
                user_id: req.user.id,
                label: label || 'Casa',
                street,
                apartment,
                city,
                department: department || 'Cochabamba',
                country: country || 'Bolivia',
                maps_link,
                door_description,
                is_default: is_default || false
            })
            .select()
            .single();
        
        if (error) return res.status(400).json({ error: error.message });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/user/addresses/:id', requireAuth, async (req, res) => {
    try {
        const { label, street, apartment, city, department, country, maps_link, door_description, is_default } = req.body;
        
        // Si es default, quitar default de las demás
        if (is_default) {
            await supabaseAdmin
                .from('addresses')
                .update({ is_default: false })
                .eq('user_id', req.user.id);
        }
        
        const { data, error } = await supabaseAdmin
            .from('addresses')
            .update({ label, street, apartment, city, department, country, maps_link, door_description, is_default })
            .eq('id', req.params.id)
            .eq('user_id', req.user.id)
            .select()
            .single();
        
        if (error) return res.status(400).json({ error: error.message });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/user/addresses/:id', requireAuth, async (req, res) => {
    try {
        const { error } = await supabaseAdmin
            .from('addresses')
            .delete()
            .eq('id', req.params.id)
            .eq('user_id', req.user.id);
        
        if (error) return res.status(400).json({ error: error.message });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- PEDIDOS DEL USUARIO ---

app.get('/api/user/orders', requireAuth, async (req, res) => {
    try {
        const { data: orders, error } = await supabaseAdmin
            .from('orders')
            .select(`
                *,
                order_items (*)
            `)
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false });
        
        if (error) return res.status(400).json({ error: error.message });
        res.json(orders);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- HELPER: Crear transporter Gmail bajo demanda (compatible con Vercel Serverless) ---
function createGmailTransporter(user, pass) {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
        pool: false,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        tls: { rejectUnauthorized: false }
    });
}


async function sendOrderEmails(orderData, items) {
    try {
        // Pre-fetch config y admin emails en paralelo (no secuencial)
        const [emailConfig, [adminRows]] = await Promise.all([
            getEmailConfig(),
            pool.query("SELECT email FROM admin_emails")
        ]);
        const adminEmails = adminRows.map(r => r.email);

        // Construir HTML del cliente
        const itemsHtml = items.map(i => `
            <tr>
                <td style="padding: 10px; border-bottom: 1px solid #eaeaea;">${i.product_name || i.name}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eaeaea; text-align: center;">${i.quantity}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eaeaea; text-align: right;">BOB ${(i.price * i.quantity).toFixed(2)}</td>
            </tr>
        `).join('');

        const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 650px; margin: auto; border: 1px solid #eaeaea; border-radius: 12px; overflow: hidden; color: #333;">
                <div style="background-color: #000; color: #fff; padding: 25px; text-align: center;">
                    <h2 style="margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 2px;">¡Gracias por tu compra, ${orderData.contact_name}!</h2>
                    <p style="margin: 5px 0 0 0; color: #aaa;">Pedido #${orderData.order_number}</p>
                </div>
                
                <div style="padding: 30px;">
                    <p style="font-size: 16px;">Hemos recibido tu pedido exitosamente y ya lo estamos preparando.</p>
                    
                    <h3 style="text-transform: uppercase; border-bottom: 2px solid #000; padding-bottom: 10px; margin-top: 30px;">Resumen de tu Pedido</h3>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <thead>
                            <tr style="background-color: #f9f9f9; text-transform: uppercase; font-size: 12px;">
                                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #eaeaea;">Producto</th>
                                <th style="padding: 10px; text-align: center; border-bottom: 2px solid #eaeaea;">Cant.</th>
                                <th style="padding: 10px; text-align: right; border-bottom: 2px solid #eaeaea;">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHtml}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colspan="2" style="padding: 10px; text-align: right; color: #666;">Subtotal</td>
                                <td style="padding: 10px; text-align: right; color: #666;">BOB ${Number(orderData.subtotal).toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td colspan="2" style="padding: 10px; text-align: right; color: #666;">Envío</td>
                                <td style="padding: 10px; text-align: right; color: #666;">BOB ${Number(orderData.shipping_cost).toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td colspan="2" style="padding: 10px; text-align: right; font-weight: bold; font-size: 18px;">Total</td>
                                <td style="padding: 10px; text-align: right; font-weight: bold; font-size: 18px;">BOB ${Number(orderData.total).toFixed(2)}</td>
                            </tr>
                        </tfoot>
                    </table>

                    <h3 style="text-transform: uppercase; border-bottom: 2px solid #000; padding-bottom: 10px; margin-top: 30px;">Detalles de Entrega</h3>
                    <p style="margin: 5px 0;"><strong>Dirección:</strong> ${orderData.shipping_address}</p>
                    <p style="margin: 5px 0;"><strong>Ciudad:</strong> ${orderData.shipping_city}</p>
                    <p style="margin: 15px 0;">Te contactaremos pronto por WhatsApp para coordinar la entrega.</p>
                    
                    <div style="text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #eaeaea;">
                        <p style="color: #666; font-size: 12px; margin-bottom: 10px; line-height: 1.5;">
                            En caso de algún problema o si deseas cancelar tu pedido, <br>
                            <a href="https://wa.me/${(orderData.seller_number || '').replace(/\D/g, '')}?text=${encodeURIComponent('Hola, tengo un problema con mi pedido #' + orderData.order_number)}" style="color: #000; font-weight: bold; text-decoration: underline;">escríbenos por WhatsApp aquí</a>.
                        </p>
                        <p style="color: #999; font-size: 11px; margin: 0;">Emma Store Bolivia</p>
                    </div>
                </div>
            </div>
        `;

        // Construir HTML del admin
        const adminUrl = process.env.ADMIN_URL || 'https://emmastore.qzz.io/admin.html';
        const itemsAdminHtml = items.map(i => `
            <tr>
                <td style="padding: 10px; border-bottom: 1px solid #eaeaea;">${i.product_name || i.name}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eaeaea; text-align: center;">${i.quantity}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eaeaea; text-align: right;">BOB ${(i.price * i.quantity).toFixed(2)}</td>
            </tr>
        `).join('');

        const adminHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 650px; margin: auto; border: 1px solid #eaeaea; border-radius: 12px; overflow: hidden; color: #333;">
                <div style="background-color: #000; color: #fff; padding: 25px; text-align: center;">
                    <h2 style="margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 2px;">Nuevo Pedido Recibido</h2>
                    <p style="margin: 5px 0 0 0; color: #aaa;">Pedido #${orderData.order_number}</p>
                </div>
                
                <div style="padding: 30px;">
                    <h3 style="text-transform: uppercase; border-bottom: 2px solid #000; padding-bottom: 10px; margin-top: 0;">Resumen de Productos</h3>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <thead>
                            <tr style="background-color: #f9f9f9; text-transform: uppercase; font-size: 12px;">
                                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #eaeaea;">Producto</th>
                                <th style="padding: 10px; text-align: center; border-bottom: 2px solid #eaeaea;">Cant.</th>
                                <th style="padding: 10px; text-align: right; border-bottom: 2px solid #eaeaea;">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsAdminHtml}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colspan="2" style="padding: 10px; text-align: right; color: #666;">Subtotal</td>
                                <td style="padding: 10px; text-align: right; color: #666;">BOB ${Number(orderData.subtotal).toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td colspan="2" style="padding: 10px; text-align: right; color: #666;">Envío</td>
                                <td style="padding: 10px; text-align: right; color: #666;">BOB ${Number(orderData.shipping_cost).toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td colspan="2" style="padding: 10px; text-align: right; font-weight: bold; font-size: 18px;">Total</td>
                                <td style="padding: 10px; text-align: right; font-weight: bold; font-size: 18px;">BOB ${Number(orderData.total).toFixed(2)}</td>
                            </tr>
                        </tfoot>
                    </table>

                    <h3 style="text-transform: uppercase; border-bottom: 2px solid #000; padding-bottom: 10px;">Datos del Cliente</h3>
                    <p style="margin: 5px 0;"><strong>Nombre:</strong> ${orderData.contact_name}</p>
                    <p style="margin: 5px 0;"><strong>Celular:</strong> <a href="https://wa.me/${(orderData.contact_phone || '').replace(/\D/g, '')}" style="color: #25D366; text-decoration: none; font-weight: bold;">${orderData.contact_phone}</a></p>
                    <p style="margin: 5px 0;"><strong>Correo:</strong> ${orderData.contact_email}</p>

                    <h3 style="text-transform: uppercase; border-bottom: 2px solid #000; padding-bottom: 10px; margin-top: 20px;">Datos de Entrega</h3>
                    <p style="margin: 5px 0;"><strong>Ciudad:</strong> ${orderData.shipping_city} / ${orderData.shipping_department}</p>
                    <p style="margin: 5px 0;"><strong>Dirección:</strong> ${orderData.shipping_address}</p>
                    ${orderData.shipping_apartment ? `<p style="margin: 5px 0;"><strong>Detalle/Piso:</strong> ${orderData.shipping_apartment}</p>` : ''}
                    ${orderData.shipping_door_desc ? `<p style="margin: 5px 0;"><strong>Fachada:</strong> ${orderData.shipping_door_desc}</p>` : ''}
                    ${orderData.shipping_maps_link ? `<p style="margin: 5px 0;"><strong>Google Maps:</strong> <a href="${orderData.shipping_maps_link}" style="color: #0066cc;">Ver ubicación</a></p>` : ''}
                    
                    <p style="margin: 20px 0 5px 0;"><strong>Vendedor asignado:</strong> ${orderData.seller_name}</p>

                    <div style="text-align: center; margin-top: 40px;">
                        <a href="${adminUrl}?order=${orderData.order_number}" style="display: inline-block; padding: 15px 30px; background-color: #000; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">Ver Detalles en Admin Panel</a>
                    </div>
                </div>
            </div>
        `;

        // --- ENVIAR AMBOS CORREOS EN PARALELO ---
        const emailPromises = [];

        // Promesa 1: Email al cliente
        if (orderData.contact_email) {
            if (emailConfig.active_client_method === 'sendpulse' && process.env.SENDPULSE_ID && process.env.SENDPULSE_SECRET) {
                emailPromises.push(
                    (async () => {
                        try {
                            const tokenRes = await fetch('https://api.sendpulse.com/oauth/access_token', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ grant_type: 'client_credentials', client_id: process.env.SENDPULSE_ID, client_secret: process.env.SENDPULSE_SECRET })
                            });
                            const tokenData = await tokenRes.json();
                            if (tokenData.access_token) {
                                const sendRes = await fetch('https://api.sendpulse.com/smtp/emails', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenData.access_token}` },
                                    body: JSON.stringify({ email: { html: Buffer.from(emailHtml).toString('base64'), text: `Pedido #${orderData.order_number} confirmado. Total: BOB ${orderData.total}`, subject: `Confirmación de pedido #${orderData.order_number} - Emma Store`, from: { name: 'Emma Store', email: process.env.SENDPULSE_SENDER_EMAIL || process.env.GMAIL_USER_2 || 'pedidos@emmastore.com' }, to: [{ name: orderData.contact_name, email: orderData.contact_email }] } })
                                });
                                if (sendRes.ok) { await incrementEmailCount('sendpulse'); console.log('Email cliente enviado vía SendPulse'); }
                            }
                        } catch (e) { console.error('Error SendPulse cliente:', e); }
                    })()
                );
            } else {
                const userMail = process.env.GMAIL_USER_2 || process.env.GMAIL_USER;
                const passMail = process.env.GMAIL_PASS_2 || process.env.GMAIL_PASS;
                if (userMail && passMail) {
                    emailPromises.push(
                        (async () => {
                            try {
                                const t = createGmailTransporter(userMail, passMail);
                                await t.sendMail({ from: `"Emma Store" <${userMail}>`, to: orderData.contact_email, subject: `Confirmación de pedido #${orderData.order_number} - Emma Store`, html: emailHtml });
                                console.log('Email cliente enviado vía Gmail');
                                await incrementEmailCount('gmail2');
                            } catch (e) { console.error('Error Gmail cliente:', e); await createLog('EMAIL_ERROR', `Error email cliente (${orderData.contact_email}): ${e.message}`); }
                        })()
                    );
                }
            }
        }

        // Promesa 2: Email a admins (Siempre Gmail)
        if (adminEmails.length > 0 && process.env.GMAIL_USER && process.env.GMAIL_PASS) {
            emailPromises.push(
                (async () => {
                    try {
                        const t = createGmailTransporter(process.env.GMAIL_USER, process.env.GMAIL_PASS);
                        await t.sendMail({ 
                            from: `"Emma Store Admin" <${process.env.GMAIL_USER}>`, 
                            to: adminEmails.join(','), 
                            subject: `¡Nuevo Pedido! #${orderData.order_number} - BOB ${orderData.total}`, 
                            html: adminHtml 
                        });
                        console.log('Email admin enviado vía Gmail');
                        await incrementEmailCount('admin');
                    } catch (e) { 
                        console.error('Error Gmail admin:', e); 
                        await createLog('EMAIL_ERROR', `Error email admin: ${e.message}`); 
                    }
                })()
            );
        }

        // Ejecutar todos en paralelo (no secuencial)
        await Promise.allSettled(emailPromises);
    } catch (err) {
        console.error("Error in sendOrderEmails:", err);
    }
}

// --- PEDIDOS PÚBLICOS (MODO VISITANTE) ---

app.post('/api/public/orders', async (req, res) => {
    try {
        const { orderData, items } = req.body;
        
        // Insertar el pedido en Supabase con user_id = null
        const { data: order, error: orderError } = await supabaseAdmin
            .from('orders')
            .insert({
                user_id: null,
                order_number: orderData.order_number,
                subtotal: orderData.subtotal,
                shipping_cost: orderData.shipping_cost,
                total: orderData.total,
                shipping_method: orderData.shipping_method || 'express',
                status: 'confirmado',
                contact_name: orderData.contact_name,
                contact_email: orderData.contact_email,
                contact_phone: orderData.contact_phone || '',
                shipping_address: orderData.shipping_address || '',
                shipping_city: orderData.shipping_city || '',
                shipping_department: orderData.shipping_department || '',
                shipping_maps_link: orderData.shipping_maps_link || '',
                shipping_door_desc: orderData.shipping_door_desc || '',
                shipping_apartment: orderData.shipping_apartment || '',
                seller_name: orderData.seller_name || '',
                seller_number: orderData.seller_number || ''
            })
            .select()
            .single();
        
        if (orderError) return res.status(400).json({ error: orderError.message });
        
        // Insertar los items del pedido
        if (items && items.length > 0) {
            const orderItems = items.map(item => ({
                order_id: order.id,
                product_id: item.product_id || item.id || null,
                product_name: item.product_name || item.name,
                product_image: item.images ? item.images[0] : item.product_image || '',
                price: item.price,
                quantity: item.quantity
            }));
            
            await supabaseAdmin.from('order_items').insert(orderItems);
        }

        // Responder al cliente PRIMERO (antes de enviar correos)
        res.json({ success: true, order });

        // Enviar correos DESPUÉS (la función sigue viva en Vercel)
        sendOrderEmails(order, items).catch(e => console.error('Error async emails:', e));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/user/orders', requireAuth, async (req, res) => {
    try {
        const { 
            order_number, subtotal, shipping_cost, total, shipping_method, 
            contact_name, contact_email, contact_phone,
            shipping_address, shipping_city, shipping_department, 
            shipping_maps_link, shipping_door_desc, shipping_apartment,
            seller_name, seller_number, items 
        } = req.body;
        
        // Insertar el pedido
        const { data: order, error: orderError } = await supabaseAdmin
            .from('orders')
            .insert({
                user_id: req.user.id,
                order_number,
                subtotal,
                shipping_cost,
                total,
                shipping_method,
                status: 'confirmado',
                contact_name,
                contact_email,
                contact_phone,
                shipping_address,
                shipping_city,
                shipping_department,
                shipping_maps_link,
                shipping_door_desc,
                shipping_apartment,
                seller_name,
                seller_number
            })
            .select()
            .single();
        
        if (orderError) return res.status(400).json({ error: orderError.message });
        
        // Insertar los items del pedido
        const orderItems = items.map(item => ({
            order_id: order.id,
            product_id: item.product_id || item.id || null,
            product_name: item.product_name || item.name,
            product_image: item.images ? item.images[0] : item.product_image || '',
            price: item.price,
            quantity: item.quantity
        }));
        
        const { error: itemsError } = await supabaseAdmin
            .from('order_items')
            .insert(orderItems);
        
        if (itemsError) return res.status(400).json({ error: itemsError.message });
        
        // Responder al cliente PRIMERO
        res.json({ success: true, order });
        
        // Enviar correos DESPUÉS (la función sigue viva en Vercel)
        sendOrderEmails(order, items).catch(e => console.error('Error async emails:', e));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ADMIN: USUARIOS REGISTRADOS ---

app.get('/api/admin/users', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) return res.status(400).json({ error: error.message });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ADMIN: TODOS LOS PEDIDOS ---

app.get('/api/admin/orders', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('orders')
            .select(`
                *,
                order_items (*)
            `)
            .order('created_at', { ascending: false });
        
        if (error) return res.status(400).json({ error: error.message });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ADMIN: ACTUALIZAR ESTADO DE PEDIDO ---

app.put('/api/admin/orders/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const allowedStatuses = ['confirmado', 'en_proceso', 'enviado', 'entregado', 'cancelado'];
        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ error: "Estado no válido" });
        }
        
        const { data, error } = await supabaseAdmin
            .from('orders')
            .update({ status })
            .eq('id', req.params.id)
            .select()
            .single();
        
        if (error) return res.status(400).json({ error: error.message });
        await createLog("PEDIDO", `Orden #${data.order_number} → ${status}`);
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ADMIN: DETALLE DE UN USUARIO + SUS PEDIDOS ---

app.get('/api/admin/users/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        
        // Obtener perfil
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();
        
        if (profileError) return res.status(404).json({ error: "Usuario no encontrado" });
        
        // Obtener direcciones del usuario
        const { data: addresses } = await supabaseAdmin
            .from('addresses')
            .select('*')
            .eq('user_id', userId)
            .order('is_default', { ascending: false });
        
        // Obtener pedidos del usuario
        const { data: orders } = await supabaseAdmin
            .from('orders')
            .select(`*, order_items (*)`)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        
        res.json({ profile, addresses: addresses || [], orders: orders || [] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ADMIN: DETALLE DE UN PEDIDO ESPECÍFICO ---

app.get('/api/admin/orders/:orderId', async (req, res) => {
    try {
        const { data: order, error } = await supabaseAdmin
            .from('orders')
            .select(`*, order_items (*)`)
            .eq('id', req.params.orderId)
            .single();
        
        if (error) return res.status(404).json({ error: "Pedido no encontrado" });
        
        // Si tiene user_id, obtener perfil del usuario
        let userProfile = null;
        if (order.user_id) {
            const { data: profile } = await supabaseAdmin
                .from('profiles')
                .select('*')
                .eq('id', order.user_id)
                .single();
            userProfile = profile;
        }
        
        res.json({ order, userProfile });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ADMIN: SISTEMA OTP PARA VERIFICAR CORREOS DE ADMINISTRADORES ---

app.post('/api/admin/emails/send-otp', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: "Correo inválido" });
        }
        
        const cleanEmail = email.trim();
        
        // Verificar si ya existe
        const [existing] = await pool.query("SELECT id FROM admin_emails WHERE email = ?", [cleanEmail]);
        if (existing.length > 0) {
            return res.status(400).json({ error: "Este correo ya está registrado" });
        }
        
        // Generar código OTP de 6 dígitos
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Date.now() + (10 * 60 * 1000); // 10 minutos
        
        // Crear tabla si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS otp_codes (
                email VARCHAR(255) PRIMARY KEY,
                code VARCHAR(10) NOT NULL,
                expires_at BIGINT NOT NULL
            )
        `);
        
        // Guardar o actualizar OTP en BD
        await pool.query(`
            INSERT INTO otp_codes (email, code, expires_at) 
            VALUES (?, ?, ?) 
            ON DUPLICATE KEY UPDATE code = VALUES(code), expires_at = VALUES(expires_at)
        `, [cleanEmail, otpCode, expiresAt]);
        
        // Enviar OTP por Gmail
        if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
            return res.status(500).json({ error: "Gmail no configurado en el servidor" });
        }
        
        const otpHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; border: 1px solid #eaeaea; border-radius: 16px; overflow: hidden;">
                <div style="background-color: #000; color: #fff; padding: 30px; text-align: center;">
                    <h2 style="margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 3px;">Emma Store Admin</h2>
                    <p style="margin: 8px 0 0 0; color: #aaa; font-size: 12px;">Código de Verificación</p>
                </div>
                <div style="padding: 40px; text-align: center;">
                    <p style="color: #666; font-size: 14px; margin-bottom: 30px;">
                        Alguien solicitó agregar este correo como administrador de Emma Store. 
                        Usa el siguiente código para confirmar:
                    </p>
                    <div style="background: #f5f5f5; border: 2px dashed #ccc; border-radius: 16px; padding: 30px; margin: 0 auto; max-width: 300px; cursor: pointer;" 
                         onclick="navigator.clipboard.writeText('${otpCode}')">
                        <p style="font-size: 48px; font-weight: 900; letter-spacing: 12px; margin: 0; color: #000; font-family: monospace;">${otpCode}</p>
                        <p style="font-size: 11px; color: #999; margin-top: 12px; text-transform: uppercase; letter-spacing: 2px;">
                            Haz clic para copiar
                        </p>
                    </div>
                    <p style="color: #999; font-size: 11px; margin-top: 30px;">
                        Este código expira en <strong>10 minutos</strong>.<br>
                        Si no solicitaste esto, ignora este correo.
                    </p>
                </div>
            </div>
        `;
        
        const otpTransporter = createGmailTransporter(process.env.GMAIL_USER, process.env.GMAIL_PASS);
        await otpTransporter.sendMail({
            from: '"Emma Store Admin" <' + process.env.GMAIL_USER + '>',
            to: cleanEmail,
            subject: `Código de verificación: ${otpCode} — Emma Store Admin`,
            html: otpHtml
        });
        
        console.log(`OTP guardado en BD y enviado a ${cleanEmail}: ${otpCode}`);
        await incrementEmailCount('admin');
        res.json({ success: true, message: "Código enviado al correo" });
    } catch (err) {
        console.error("Error enviando OTP:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/emails/verify-otp', async (req, res) => {
    try {
        const { email, code } = req.body;
        if (!email || !code) {
            return res.status(400).json({ error: "Correo y código son requeridos" });
        }
        
        const cleanEmail = email.trim();
        const cleanCode = code.trim();
        
        const [rows] = await pool.query("SELECT * FROM otp_codes WHERE email = ?", [cleanEmail]);
        
        if (rows.length === 0) {
            return res.status(400).json({ error: "No se encontró un código para este correo. Solicita uno nuevo." });
        }
        
        const stored = rows[0];
        
        if (stored.expires_at < Date.now()) {
            await pool.query("DELETE FROM otp_codes WHERE email = ?", [cleanEmail]);
            return res.status(400).json({ error: "El código ha expirado. Solicita uno nuevo." });
        }
        
        if (stored.code !== cleanCode) {
            return res.status(400).json({ error: "Código incorrecto. Verifica e intenta nuevamente." });
        }
        
        // Código válido — limpiar tabla temporal y agregar el correo
        await pool.query("DELETE FROM otp_codes WHERE email = ?", [cleanEmail]);
        await pool.execute("INSERT INTO admin_emails (email) VALUES (?)", [cleanEmail]);
        await createLog("EMAIL_ADMIN", `Verificado y agregado correo: ${cleanEmail}`);
        
        res.json({ success: true, message: "Correo verificado y agregado exitosamente" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================
// STORE CONFIG (Precio Envío, Transportadora, Zonas)
// =============================================

async function initStoreConfig() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS store_config (
            id INT PRIMARY KEY DEFAULT 1,
            shipping_cost DECIMAL(10,2) DEFAULT 15.00,
            carrier_cost DECIMAL(10,2) DEFAULT 25.00,
            delivery_zones JSON DEFAULT ('["Cochabamba"]'),
            qr_payment_url TEXT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
    try {
        await pool.query("ALTER TABLE store_config ADD COLUMN qr_payment_url TEXT NULL");
    } catch (_) {}
    const [rows] = await pool.query("SELECT * FROM store_config WHERE id = 1");
    if (rows.length === 0) {
        await pool.query(
            "INSERT INTO store_config (id, shipping_cost, carrier_cost, delivery_zones) VALUES (1, 15.00, 25.00, ?)",
            [JSON.stringify(["Cochabamba"])]
        );
    }
}

// Endpoint público — movido al bloque SHIPPING OPTIONS (incluye opciones de envío)


// Endpoint admin — leer configuración completa
app.get('/api/admin/store-config', async (req, res) => {
    try {
        await initStoreConfig();
        const [rows] = await pool.query("SELECT * FROM store_config WHERE id = 1");
        if (rows.length === 0) return res.json({ shipping_cost: 15, carrier_cost: 25, delivery_zones: ["Cochabamba"], qr_payment_url: null });
        const r = rows[0];
        res.json({
            shipping_cost: parseFloat(r.shipping_cost),
            carrier_cost: parseFloat(r.carrier_cost),
            delivery_zones: typeof r.delivery_zones === 'string' ? JSON.parse(r.delivery_zones) : r.delivery_zones,
            qr_payment_url: r.qr_payment_url || null,
            updated_at: r.updated_at
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Endpoint admin — actualizar configuración
app.put('/api/admin/store-config', async (req, res) => {
    try {
        await initStoreConfig();
        const { shipping_cost, carrier_cost, delivery_zones, qr_payment_url } = req.body;
        const updates = [];
        const values = [];
        if (shipping_cost !== undefined) { updates.push('shipping_cost = ?'); values.push(parseFloat(shipping_cost)); }
        if (carrier_cost !== undefined) { updates.push('carrier_cost = ?'); values.push(parseFloat(carrier_cost)); }
        if (delivery_zones !== undefined) { updates.push('delivery_zones = ?'); values.push(JSON.stringify(delivery_zones)); }
        if (qr_payment_url !== undefined) { updates.push('qr_payment_url = ?'); values.push(qr_payment_url); }
        if (updates.length === 0) return res.status(400).json({ error: "Nada que actualizar" });
        values.push(1);
        await pool.query(`UPDATE store_config SET ${updates.join(', ')} WHERE id = ?`, values);
        await createLog("CONFIG_ENTREGA", `Actualizado: ${updates.join(', ')}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ADMIN: Firma para subida directa a Cloudinary (QR, etc.) ---
app.get('/api/admin/cloudinary-sign', (req, res) => {
    try {
        const timestamp = Math.round(Date.now() / 1000);
        const folder = req.query.folder || 'store/qr';
        const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
        const signature = require('crypto')
            .createHash('sha1')
            .update(paramsToSign + process.env.CLOUDINARY_API_SECRET)
            .digest('hex');
        
        res.json({
            signature,
            timestamp,
            folder,
            api_key: process.env.CLOUDINARY_API_KEY,
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ADMIN: Eliminar imagen de Cloudinary por URL ---
app.post('/api/admin/cloudinary-delete', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL requerida' });
        // Extraer public_id de la URL de Cloudinary
        const match = url.match(/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z]+)?$/);
        if (!match) return res.status(400).json({ error: 'URL de Cloudinary inválida' });
        const publicId = match[1];
        await cloudinary.uploader.destroy(publicId);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================
// SHIPPING OPTIONS — CRUD completo
// =============================================

async function initShippingOptions() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS shipping_options (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(120) NOT NULL,
            description VARCHAR(255),
            price DECIMAL(10,2) DEFAULT 0.00,
            type ENUM('domicilio','encomienda') DEFAULT 'domicilio',
            sort_order INT DEFAULT 0,
            is_active TINYINT(1) DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    const [rows] = await pool.query("SELECT COUNT(*) as cnt FROM shipping_options");
    if (rows[0].cnt === 0) {
        await pool.query(`
            INSERT INTO shipping_options (title, description, price, type, sort_order) VALUES
            ('Envío Delivery Express', 'Entrega directa en la puerta de tu casa', 15.00, 'domicilio', 1),
            ('Retiro en Punto de Encuentro', 'Coordinar entrega en un punto estratégico sin costo de envío', 0.00, 'domicilio', 2)
        `);
    }
}

// Público: obtener opciones activas + config + zonas
app.get('/api/store-config', async (req, res) => {
    try {
        await initStoreConfig();
        await initShippingOptions();
        const [cfgRows] = await pool.query("SELECT shipping_cost, carrier_cost, delivery_zones, qr_payment_url FROM store_config WHERE id = 1");
        const [optRows] = await pool.query("SELECT * FROM shipping_options WHERE is_active = 1 ORDER BY sort_order, id");
        const cfg = cfgRows[0] || { shipping_cost: 15, carrier_cost: 25, delivery_zones: '["Cochabamba"]', qr_payment_url: null };
        res.json({
            shipping_cost: parseFloat(cfg.shipping_cost),
            carrier_cost: parseFloat(cfg.carrier_cost),
            delivery_zones: typeof cfg.delivery_zones === 'string' ? JSON.parse(cfg.delivery_zones) : cfg.delivery_zones,
            qr_payment_url: cfg.qr_payment_url || null,
            shipping_options: optRows.map(o => ({ ...o, price: parseFloat(o.price) }))
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin: listar todas las opciones
app.get('/api/admin/shipping-options', async (req, res) => {
    try {
        await initShippingOptions();
        const [rows] = await pool.query("SELECT * FROM shipping_options ORDER BY sort_order, id");
        res.json(rows.map(o => ({ ...o, price: parseFloat(o.price) })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin: crear opción
app.post('/api/admin/shipping-options', async (req, res) => {
    try {
        await initShippingOptions();
        const { title, description = '', price = 0, type = 'domicilio', sort_order = 0 } = req.body;
        if (!title) return res.status(400).json({ error: "Título requerido" });
        const [result] = await pool.query(
            "INSERT INTO shipping_options (title, description, price, type, sort_order) VALUES (?, ?, ?, ?, ?)",
            [title, description, parseFloat(price), type, sort_order]
        );
        await createLog("SHIPPING_OPTION_ADD", `Nueva opción: ${title}`);
        res.json({ success: true, id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin: actualizar opción
app.put('/api/admin/shipping-options/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, price, type, sort_order, is_active } = req.body;
        const updates = []; const values = [];
        if (title !== undefined) { updates.push('title = ?'); values.push(title); }
        if (description !== undefined) { updates.push('description = ?'); values.push(description); }
        if (price !== undefined) { updates.push('price = ?'); values.push(parseFloat(price)); }
        if (type !== undefined) { updates.push('type = ?'); values.push(type); }
        if (sort_order !== undefined) { updates.push('sort_order = ?'); values.push(sort_order); }
        if (is_active !== undefined) { updates.push('is_active = ?'); values.push(is_active ? 1 : 0); }
        if (updates.length === 0) return res.status(400).json({ error: "Nada que actualizar" });
        values.push(id);
        await pool.query(`UPDATE shipping_options SET ${updates.join(', ')} WHERE id = ?`, values);
        await createLog("SHIPPING_OPTION_EDIT", `Opción ${id} actualizada`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin: eliminar opción
app.delete('/api/admin/shipping-options/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("DELETE FROM shipping_options WHERE id = ?", [id]);
        await createLog("SHIPPING_OPTION_DELETE", `Opción ${id} eliminada`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = app;