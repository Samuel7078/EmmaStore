const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
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

app.put('/api/admin/update-password', async (req, res) => {
    const { newPassword } = req.body;
    try {
        const newHashedValue = hashPassword(newPassword);
        await pool.execute("UPDATE admin_user SET password = ? WHERE username = 'admin'", [newHashedValue]);
        await createLog("SEGURIDAD", "Cambio de contraseña maestra");
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
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

// --- STORIES (SOPORTE MÚLTIPLE E IGUAL QUE PRODUCTOS) ---

app.get('/api/stories', async (req, res) => {
    try {
        const limit24h = Date.now() - (24 * 60 * 60 * 1000);
        const [rows] = await pool.query("SELECT * FROM stories WHERE createdAt > ? ORDER BY id DESC", [limit24h]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/stories', async (req, res) => {
    // CORRECCIÓN: Ahora acepta un array de imágenes igual que productos
    const { images, contactId, customMsg } = req.body;
    try {
        const uploaded = await uploadToCloudinary(images, 'stories');
        
        // Insertamos cada imagen como una story individual
        for (const url of uploaded) {
            await pool.execute(
                "INSERT INTO stories (imageUrl, contactId, customMsg, createdAt) VALUES (?,?,?,?)",
                [url, contactId, customMsg || "", Date.now()]
            );
        }
        
        await createLog("STORY", `Subidas ${uploaded.length} stories`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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
        const allowed = ['products', 'categories', 'contacts', 'stories'];
        if (!allowed.includes(req.params.table)) return res.status(400).send("No permitido");
        await pool.execute(`DELETE FROM ${req.params.table} WHERE id = ?`, [req.params.id]);
        await createLog("ELIMINAR", `${req.params.table} ID: ${req.params.id}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = app;