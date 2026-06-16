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

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
    }
});


async function sendOrderEmails(orderData, items) {
    try {
        // 1. Enviar a cliente
        if (orderData.contact_email) {
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
                            <p style="color: #666; font-size: 12px; margin: 0;">Emma Store Bolivia</p>
                        </div>
                    </div>
                </div>
            `;

            if (process.env.SENDPULSE_ACTIVE === 'true' && process.env.SENDPULSE_ID && process.env.SENDPULSE_SECRET) {
                try {
                    // Obtener Token
                    const tokenRes = await fetch('https://api.sendpulse.com/oauth/access_token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            grant_type: 'client_credentials',
                            client_id: process.env.SENDPULSE_ID,
                            client_secret: process.env.SENDPULSE_SECRET
                        })
                    });
                    const tokenData = await tokenRes.json();
                    
                    if (tokenData.access_token) {
                        const emailPayload = {
                            email: {
                                html: emailHtml,
                                text: `Pedido #${orderData.order_number} confirmado. Total: BOB ${orderData.total}`,
                                subject: `Confirmación de pedido #${orderData.order_number} - Emma Store`,
                                from: {
                                    name: 'Emma Store',
                                    email: process.env.SENDPULSE_SENDER_EMAIL || 'pedidos@emmastore.com'
                                },
                                to: [{ name: orderData.contact_name, email: orderData.contact_email }]
                            }
                        };
                        
                        const sendRes = await fetch('https://api.sendpulse.com/smtp/emails', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${tokenData.access_token}`
                            },
                            body: JSON.stringify(emailPayload)
                        });
                        
                        const sendData = await sendRes.json();
                        console.log('Sendpulse API result:', sendData);
                    } else {
                        console.error("Error obteniendo token de SendPulse:", tokenData);
                    }
                } catch (spError) {
                    console.error("Error al enviar SendPulse vía API:", spError);
                }
            } else if (process.env.GMAIL_USER_2 && process.env.GMAIL_PASS_2) {
                try {
                    const clientTransporter = nodemailer.createTransport({
                        service: 'gmail',
                        auth: {
                            user: process.env.GMAIL_USER_2,
                            pass: process.env.GMAIL_PASS_2
                        }
                    });
                    
                    const clientMailOptions = {
                        from: '"Emma Store" <' + process.env.GMAIL_USER_2 + '>',
                        to: orderData.contact_email,
                        subject: `Confirmación de pedido #${orderData.order_number} - Emma Store`,
                        html: emailHtml
                    };
                    
                    const info = await clientTransporter.sendMail(clientMailOptions);
                    console.log("Email cliente enviado vía Gmail secundario:", info.response);
                } catch (gmError) {
                    console.error("Error enviando email al cliente vía Gmail secundario:", gmError);
                }
            }
        }

        // 2. Enviar a admins con Gmail (Nodemailer)
        if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
            const [adminRows] = await pool.query("SELECT email FROM admin_emails");
            const adminEmails = adminRows.map(r => r.email);
            
            if (adminEmails.length > 0) {
                const adminUrl = process.env.ADMIN_URL || 'https://tu-dominio.com/admin.html';
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
                const mailOptions = {
                    from: '"Emma Store Admin" <' + process.env.GMAIL_USER + '>',
                    to: adminEmails.join(','),
                    subject: `¡Nuevo Pedido! #${orderData.order_number} - BOB ${orderData.total}`,
                    html: adminHtml
                };
                try {
                    const info = await transporter.sendMail(mailOptions);
                    console.log("Email admin enviado:", info.response);
                } catch (error) {
                    console.error("Error enviando email admin:", error);
                }
            }
        }
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

        // Envía el correo usando el registro recién creado
        await sendOrderEmails(order, items);
        
        res.json({ success: true, order });
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
            product_id: item.product_id || item.id,
            product_name: item.name,
            product_image: item.images ? item.images[0] : item.product_image,
            price: item.price,
            quantity: item.quantity
        }));
        
        const { error: itemsError } = await supabaseAdmin
            .from('order_items')
            .insert(orderItems);
        
        if (itemsError) return res.status(400).json({ error: itemsError.message });
        
        // Enviar correos de confirmación (await es necesario en Vercel Serverless)
        await sendOrderEmails(order, items);
        
        res.json({ success: true, order });
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
        
        await transporter.sendMail({
            from: '"Emma Store Admin" <' + process.env.GMAIL_USER + '>',
            to: cleanEmail,
            subject: `Código de verificación: ${otpCode} — Emma Store Admin`,
            html: otpHtml
        });
        
        console.log(`OTP guardado en BD y enviado a ${cleanEmail}: ${otpCode}`);
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

// --- SITEMAP DINÁMICO (SEO) ---
app.get('/api/sitemap', async (req, res) => {
    try {
        // En Vercel o producción, puedes ajustar el dominio base. 
        // Por defecto usaremos el host que haga la petición si está disponible, o uno estático.
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        const host = req.headers.host || 'tu-dominio.com';
        const baseUrl = `${protocol}://${host}`;

        const [products] = await pool.query("SELECT id FROM products ORDER BY id DESC");
        const [categories] = await pool.query("SELECT id FROM categories");

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

        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (err) {
        console.error("Error generando sitemap:", err);
        res.status(500).send("Error generando sitemap");
    }
});

module.exports = app;