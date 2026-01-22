const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const { Resend } = require('resend');
const multer = require('multer'); 
const csv = require('csv-parser'); 
const fs = require('fs'); 

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de Multer para subida temporal de archivos
const upload = multer({ dest: 'uploads/' });

// 1. CONFIGURACIÓN DE RESEND
const resend = new Resend(process.env.RESEND_API_KEY); 

// 2. FUNCIÓN AUXILIAR: Enviar Correo con Horarios Dinámicos
async function enviarAvisoEmail(reserva, tipo) {
    let asunto = "";
    let mensajeHtml = "";
    let destinatario = reserva.cliente_email;
    
    if (tipo !== 'SOPORTE') {
        if (!destinatario || destinatario === '---' || !destinatario.includes('@')) {
            console.log(`Reserva #${reserva.id}: Sin email válido.`);
            return;
        }
    }

    // Buscamos datos de sucursal si el pedido está disponible
    let infoSucursal = { horarios: "Consultar en local", direccion: "Dirección habitual", contacto_tel: "" };
    if (tipo === 'DISPONIBLE') {
        try {
            const [rows] = await db.promise().query("SELECT * FROM sucursales WHERE nombre_sucursal = ?", [reserva.sucursal_nombre]);
            if (rows.length > 0) infoSucursal = rows[0];
        } catch (err) {
            console.error("Error al obtener horarios:", err);
        }
    }

    const footerHtml = `
        <br>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <footer style="color: #666666; font-family: sans-serif;">
            <p style="font-size: 14px; margin: 0; font-weight: bold; color: #333;">One Box - Gestión de Reservas</p>
            <p style="font-size: 11px; color: #999999; margin-top: 10px;">Este es un mensaje automático enviado por el sistema de Reservas One Box</p>
        </footer>
    `;

    if (tipo === 'CONFIRMACION') {
        asunto = `Confirmación de Reserva #${reserva.id} - En Tránsito`;
        mensajeHtml = `<div style="font-family: sans-serif; border: 1px solid #ddd; padding: 20px; border-radius: 10px;">
            <h2 style="color: #4a90e2;">¡Hola ${reserva.cliente_nombre}!</h2>
            <p>Tu reserva ha sido registrada correctamente y ya está <strong>en camino</strong>.</p>
            <p><strong>Producto:</strong> ${reserva.descripcion}</p>${footerHtml}</div>`;
    } else if (tipo === 'DISPONIBLE') {
        asunto = `¡Tu pedido ya llegó! Reserva #${reserva.id}`;
        mensajeHtml = `<div style="font-family: sans-serif; border: 1px solid #a6e3a1; padding: 20px; border-radius: 10px;">
            <h2 style="color: #2e7d32;">¡Buenas noticias, ${reserva.cliente_nombre}!</h2>
            <p>Tu producto <strong>${reserva.descripcion}</strong> ya se encuentra disponible para retirar en <strong>${reserva.sucursal_nombre}</strong>.</p>
            <div style="background: #f1f8e9; padding: 15px; border-radius: 8px; margin-top: 15px; border-left: 5px solid #a6e3a1;">
                <p style="margin: 0; color: #333;">📍 <strong>Dirección:</strong> ${infoSucursal.direccion}</p>
                <p style="margin: 5px 0; color: #333;">⏰ <strong>Horarios:</strong> ${infoSucursal.horarios}</p>
                ${infoSucursal.contacto_tel ? `<p style="margin: 0; color: #333;">📞 <strong>Teléfono:</strong> ${infoSucursal.contacto_tel}</p>` : ''}
            </div>
            <p style="margin-top: 15px;">¡Te esperamos!</p>${footerHtml}</div>`;
    } else if (tipo === 'SOPORTE') {
        destinatario = 'erco.efc@gmail.com'; 
        asunto = `🛠️ Soporte: ${reserva.tipo_ticket} - ${reserva.usuario}`;
        mensajeHtml = `<div style="font-family: sans-serif; border: 1px solid #89b4fa; padding: 20px; border-radius: 10px;">
            <h2>Nuevo Ticket de Soporte</h2>
            <p><strong>Tipo:</strong> ${reserva.tipo_ticket}</p>
            <p><strong>Usuario:</strong> ${reserva.usuario}</p>
            <hr style="border: 0; border-top: 1px solid #ddd;">
            <p><strong>Descripción:</strong></p>
            <p style="background: #f8f9fa; padding: 15px; border-radius: 5px;">${reserva.descripcion_ticket}</p>${footerHtml}</div>`;
    }

    try {
        await resend.emails.send({
            from: 'One Box <sistema@onebox.net.ar>', 
            to: destinatario,
            subject: asunto,
            html: mensajeHtml,
        });
        console.log(`✅ Email (${tipo}) enviado a:`, destinatario);
    } catch (error) {
        console.error(`❌ Error email (${tipo}):`, error);
    }
}

// 3. CONFIGURACIÓN DB
const db = mysql.createPool({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: process.env.MYSQLPORT || 4000,
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10
});

// --- RUTAS GESTIÓN DE SUCURSALES (SOLO ADMIN) ---

app.get('/admin/sucursales', (req, res) => {
    db.query("SELECT * FROM sucursales ORDER BY nombre_sucursal ASC", (err, results) => {
        if (err) return res.status(500).send('Error');
        res.json(results);
    });
});

app.post('/admin/sucursales', (req, res) => {
    const { id, nombre, direccion, horarios, contacto } = req.body;
    if (id) {
        const sql = "UPDATE sucursales SET nombre_sucursal=?, direccion=?, horarios=?, contacto_tel=? WHERE id=?";
        db.query(sql, [nombre, direccion, horarios, contacto, id], (err) => {
            if (err) return res.status(500).send('Error');
            res.send('Actualizado OK');
        });
    } else {
        const sql = "INSERT INTO sucursales (nombre_sucursal, direccion, horarios, contacto_tel) VALUES (?, ?, ?, ?)";
        db.query(sql, [nombre, direccion, horarios, contacto], (err) => {
            if (err) return res.status(500).send('Error');
            res.send('Creado OK');
        });
    }
});

// --- RUTAS DE RESERVAS Y PRODUCTOS ---

app.get('/productos/:codigo', (req, res) => {
    const { codigo } = req.params;
    const sql = "SELECT descripcion, precio_unitario FROM productos WHERE codigo = ?";
    db.query(sql, [codigo], (err, results) => {
        if (err) return res.status(500).send('Error');
        if (results.length > 0) res.json(results[0]);
        else res.status(404).send('No encontrado');
    });
});

app.post('/reservar', (req, res) => {
    const data = req.body;
    const sql = `INSERT INTO reservas 
        (cliente_nombre, cliente_telefono, cliente_email, prod_codigo, descripcion, prod_cantidad, total_reserva, sucursal_nombre, sucursal_contacto, operador_nombre, comentarios, estado, borrado, local_origen) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'En Tránsito', 0, ?)`;
    
    const valores = [
        data.cliente_nombre, data.cliente_telefono, data.cliente_email, 
        data.prod_codigo, data.descripcion, data.prod_cantidad, data.total_reserva, 
        data.local_destino, data.contacto_sucursal, 
        data.operador_nombre, data.comentarios, data.local_origen 
    ];

    db.query(sql, valores, (err, result) => {
        if (err) return res.status(500).send('Error');
        enviarAvisoEmail({ id: result.insertId, ...data, sucursal_nombre: data.local_origen }, 'CONFIRMACION');
        res.send('Guardado OK');
    });
});

app.get('/reservas', (req, res) => {
    const termino = req.query.q || ''; 
    const sucursalUsuario = req.query.sucursal ? req.query.sucursal.trim() : ''; 
    const rol = req.query.rol ? req.query.rol.trim().toLowerCase() : 'local'; 
    const filtroBusqueda = `%${termino}%`;

    let sql = `SELECT * FROM reservas WHERE (cliente_nombre LIKE ? OR prod_codigo LIKE ? OR operador_nombre LIKE ? OR local_origen LIKE ?)`;
    let parametros = [filtroBusqueda, filtroBusqueda, filtroBusqueda, filtroBusqueda];

    if (rol === 'admin') {} 
    else if (rol === 'encargado') {
        sql += " AND local_origen = ?";
        parametros.push(sucursalUsuario);
    } else {
        sql += " AND local_origen = ? AND borrado = 0";
        parametros.push(sucursalUsuario);
    }
    sql += " ORDER BY id DESC";

    db.query(sql, parametros, (err, results) => {
        if (err) return res.status(500).send('Error al leer datos');
        res.json(results);
    });
});

app.put('/reservas/:id/editar', (req, res) => {
    const id = req.params.id;
    const data = req.body;
    const sql = `UPDATE reservas SET cliente_nombre=?, cliente_telefono=?, cliente_email=?, prod_codigo=?, descripcion=?, prod_cantidad=?, total_reserva=? WHERE id=?`;
    const valores = [data.cliente_nombre, data.cliente_telefono, data.cliente_email, data.prod_codigo, data.descripcion, data.prod_cantidad, data.total_reserva, id];

    db.query(sql, valores, (err) => {
        if (err) return res.status(500).send('Error al editar');
        res.send('OK');
    });
});

app.put('/reservas/:id/estado', (req, res) => {
    const id = req.params.id;
    const { estado, borrado, responsable } = req.body;

    if (borrado !== undefined) {
        db.query("UPDATE reservas SET borrado = ?, estado = ? WHERE id = ?", [borrado, estado, id], (err) => {
            if (err) return res.status(500).send('Error');
            res.send('OK');
        });
    } else {
        let sqlUpdate = "";
        let valores = [];

        if (estado === 'Pendiente de Retiro') {
            sqlUpdate = `UPDATE reservas SET estado = ?, operador_nombre = '', responsable_recibo = ?, fecha_ingreso = NOW() WHERE id = ?`;
            valores = [estado, responsable, id];
        } else if (estado === 'Retirado' || estado === 'Cancelado') {
            sqlUpdate = `UPDATE reservas SET estado = ?, operador_nombre = '', responsable_finalizado = ?, fecha_cierre = NOW() WHERE id = ?`;
            valores = [estado, responsable, id];
        } else {
            sqlUpdate = `UPDATE reservas SET estado = ? WHERE id = ?`;
            valores = [estado, id];
        }

        db.query(sqlUpdate, valores, (err) => {
            if (err) return res.status(500).send('Error');
            if (estado === 'Pendiente de Retiro') {
                db.query("SELECT * FROM reservas WHERE id = ?", [id], (err, results) => {
                    if (!err && results.length > 0) {
                        const r = results[0];
                        r.sucursal_nombre = r.local_origen;
                        enviarAvisoEmail(r, 'DISPONIBLE');
                    }
                });
            }
            res.send('OK');
        });
    }
});

app.delete('/reservas/:id', (req, res) => {
    db.query("UPDATE reservas SET borrado = 1 WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).send('Error');
        res.send('OK');
    });
});

app.delete('/reservas_definitivas/:id', (req, res) => {
    db.query("DELETE FROM reservas WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).send('Error');
        res.send('OK');
    });
});

app.post('/login', (req, res) => {
    const { usuario, password } = req.body;
    db.query("SELECT * FROM usuarios WHERE usuario = ? AND password = ?", [usuario, password], (err, results) => {
        if (err) return res.status(500).send('Error');
        if (results.length > 0) {
            res.json({ success: true, nombre: results[0].usuario, rol: results[0].rol, sucursal: results[0].sucursal });
        } else {
            res.json({ success: false, message: 'Usuario o clave incorrectos' });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 One Box funcionando en ${PORT}`));