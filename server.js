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

// Aumentamos el límite para permitir el envío de capturas de pantalla en Base64 desde soporte.html
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: 'uploads/' });
const resend = new Resend(process.env.RESEND_API_KEY); 

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

// --- FUNCIÓN AUXILIAR: Enviar Correo (Avisos de Reservas) ---
async function enviarAvisoEmail(reserva, tipo) {
    let asunto = "";
    let mensajeHtml = "";
    let destinatario = reserva.cliente_email;
    
    // Si no es soporte, validamos el destinatario del cliente
    if (tipo !== 'SOPORTE') {
        if (!destinatario || destinatario === '---' || !destinatario.includes('@')) return;
    }

    let infoSucursal = { horarios: "Consultar en local", direccion: "Dirección habitual", contacto_tel: "" };
    
    if (tipo === 'DISPONIBLE') {
        try {
            const [rows] = await db.promise().query(
                "SELECT direccion, horarios, contacto_tel FROM usuarios WHERE sucursal = ? LIMIT 1", 
                [reserva.sucursal_nombre]
            );
            if (rows.length > 0) infoSucursal = rows[0];
        } catch (err) {
            console.error("Error al obtener info de local:", err);
        }
    }

    const footerHtml = `<br><hr><footer style="color: #666; font-family: sans-serif;">
                        <p><strong>Gestión de Reservas Mo</strong></p>
                        <p>Este es un mensaje automático, enviado por el sistema de Onebox</p>
                        </footer>`;

    if (tipo === 'CONFIRMACION') {
        asunto = `Confirmación de Reserva #${reserva.id} - En Tránsito`;
        mensajeHtml = `<h2>¡Hola ${reserva.cliente_nombre}!</h2>
                        <p>Tu reserva ha sido registrada correctamente y ya está en camino.</p>
                        <p><strong>Producto: </strong> ${reserva.descripcion}</p>
                        <p>Te avisaremos cuando puedas pasar a retirarla.</p>
                        ${footerHtml}`;
    } else if (tipo === 'DISPONIBLE') {
        asunto = `¡Tu pedido ya llegó! Reserva #${reserva.id}`;
        mensajeHtml = `<div style="font-family: sans-serif; border: 1px solid #a6e3a1; padding: 20px;">
            <h2>¡Buenas noticias, ${reserva.cliente_nombre}!</h2>
            <p>Tu reserva: <strong>${reserva.descripcion}</strong> ya está en <strong>${reserva.sucursal_nombre}</strong>.</p>
            <p>📍 Dirección: ${infoSucursal.direccion}<br>⏰ Horarios: ${infoSucursal.horarios}</p>
            </div>${footerHtml}`;
    }

    try {
        await resend.emails.send({
            from: 'Reservas Mo <reservas.mo@onebox.net.ar>', 
            to: destinatario,
            subject: asunto,
            html: mensajeHtml,
        });
    } catch (error) { console.error("Error mail:", error); }
}

// --- RUTA DE SOPORTE TÉCNICO (NUEVA INTEGRACIÓN) ---
app.post('/admin/soporte', async (req, res) => {
    const { tipo, mensaje, usuario, imagen } = req.body;
    try {
        let cuerpoHtml = `
            <div style="font-family: sans-serif; color: #333; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
                <h2 style="color: #007bff; border-bottom: 2px solid #007bff; padding-bottom: 10px;">🛠️ Nuevo Ticket de Soporte</h2>
                <p><strong>Usuario:</strong> ${usuario}</p>
                <p><strong>Motivo y Origen:</strong> ${tipo}</p>
                <div style="background: #f8f9fa; padding: 15px; border-left: 4px solid #007bff; margin: 15px 0;">
                    <strong>Descripción del problema:</strong><br>${mensaje}
                </div>
        `;

        if (imagen) {
            cuerpoHtml += `
                <p><strong>Captura de pantalla adjunta:</strong></p>
                <img src="${imagen}" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 5px; margin-top: 10px;">
            `;
        }

        cuerpoHtml += `</div><br><p style="font-size: 11px; color: #999;">Este es un mensaje automático, enviado por el sistema de Onebox</p>`;

        await resend.emails.send({
            from: 'Soporte OneBox <reservas.mo@onebox.net.ar>',
            to: 'erco.efc@gmail.com',
            subject: `🛠️ Soporte: ${tipo}`,
            html: cuerpoHtml
        });

        res.json({ success: true });
    } catch (error) {
        console.error("Error al enviar ticket:", error);
        res.status(500).json({ success: false });
    }
});

// --- RUTA ACTUALIZAR PRECIOS (ULTRA COMPATIBLE) ---
app.post('/admin/actualizar-precios', upload.single('archivoCsv'), async (req, res) => {
    const rolUsuario = req.headers['user-role'];
    if (rolUsuario !== 'admin') return res.status(403).json({ success: false });
    if (!req.file) return res.status(400).json({ success: false });

    const resultados = [];
    fs.createReadStream(req.file.path)
        .pipe(csv({ 
            separator: ';', // Específico para Excel en español
            mapHeaders: ({ header }) => header.trim().toLowerCase().replace(/^\uFEFF/, '') 
        })) 
        .on('data', (data) => {
            if (data.codigo || data.cod) resultados.push(data);
        })
        .on('end', async () => {
            try {
                let contador = 0;
                for (const fila of resultados) {
                    const codigo = fila.codigo || fila.cod;
                    let precioRaw = fila.precio_unitario || fila.precio;

                    if (codigo && precioRaw) {
                        // Limpia símbolos monetarios y maneja comas decimales
                        let precioLimpio = precioRaw.toString().replace(/[^0-9.,]/g, '');
                        if (precioLimpio.includes(',') && precioLimpio.includes('.')) {
                            precioLimpio = precioLimpio.replace(/\./g, '').replace(',', '.');
                        } else {
                            precioLimpio = precioLimpio.replace(',', '.');
                        }

                        const [resUpdate] = await db.promise().query(
                            "UPDATE productos SET precio_unitario = ? WHERE codigo = ?",
                            [precioLimpio, codigo]
                        );
                        if (resUpdate.affectedRows > 0) contador++;
                    }
                }
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                res.json({ success: true, count: contador });
            } catch (err) { 
                console.error("Error masivo:", err);
                res.status(500).json({ success: false }); 
            }
        });
});

// --- RUTAS DE RESERVAS Y ESTADOS ---
app.delete('/reservas/:id', (req, res) => {
    const id = req.params.id;
    db.query("UPDATE reservas SET borrado = 1 WHERE id = ?", [id], (err) => {
        if (err) return res.status(500).send('Error');
        res.send('OK');
    });
});

app.put('/reservas/:id/estado', (req, res) => {
    const id = req.params.id;
    const { estado, borrado, responsable } = req.body;

    if (borrado !== undefined) {
        const operadorTrazable = responsable ? responsable : 'Sistema';
        db.query("UPDATE reservas SET borrado = ?, estado = ?, operador_nombre = ? WHERE id = ?", 
        [borrado, estado, operadorTrazable, id], (err) => {
            if (err) return res.status(500).send('Error');
            res.send('OK');
        });
    } else {
        let sqlUpdate = (estado === 'Pendiente de Retiro') 
            ? `UPDATE reservas SET estado = ?, responsable_recibo = ?, fecha_ingreso = NOW() WHERE id = ?`
            : `UPDATE reservas SET estado = ?, responsable_finalizado = ?, fecha_cierre = NOW() WHERE id = ?`;

        db.query(sqlUpdate, [estado, responsable, id], (err) => {
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

app.put('/reservas/:id/editar', (req, res) => {
    const id = req.params.id;
    const { cliente_nombre, cliente_telefono, cliente_email, prod_codigo, descripcion, prod_cantidad, total_reserva, responsable_edicion } = req.body;
    const operadorActualizado = `${responsable_edicion} (Editado)`;

    const sql = `UPDATE reservas SET cliente_nombre = ?, cliente_telefono = ?, cliente_email = ?, prod_codigo = ?, descripcion = ?, prod_cantidad = ?, total_reserva = ?, operador_nombre = ? WHERE id = ?`;
    db.query(sql, [cliente_nombre, cliente_telefono, cliente_email, prod_codigo, descripcion, prod_cantidad, total_reserva, operadorActualizado, id], (err) => {
        if (err) return res.status(500).send('Error');
        res.send('OK');
    });
});

app.get('/reservas', (req, res) => {
    const { q, sucursal, rol } = req.query;
    let sql = `SELECT r.*, (SELECT direccion FROM usuarios WHERE sucursal = r.local_origen LIMIT 1) as direccion, (SELECT horarios FROM usuarios WHERE sucursal = r.local_origen LIMIT 1) as horarios FROM reservas r WHERE (r.cliente_nombre LIKE ? OR r.prod_codigo LIKE ?)`;
    let par = [`%${q}%`, `%${q}%`];
    if (rol !== 'admin') { sql += " AND r.local_origen = ?"; par.push(sucursal); }
    sql += " ORDER BY r.id DESC";
    db.query(sql, par, (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

app.post('/login', (req, res) => {
    const { usuario, password } = req.body;
    db.query("SELECT * FROM usuarios WHERE usuario = ? AND password = ?", [usuario, password], (err, results) => {
        if (results && results.length > 0) {
            res.json({ success: true, nombre: results[0].usuario, rol: results[0].rol, sucursal: results[0].sucursal });
        } else { res.json({ success: false }); }
    });
});

app.get('/productos/:codigo', (req, res) => {
    db.query("SELECT descripcion, precio_unitario FROM productos WHERE codigo = ?", [req.params.codigo], (err, results) => {
        if (err || results.length === 0) return res.status(404).send('Error');
        res.json(results[0]);
    });
});

app.post('/reservar', (req, res) => {
    const data = req.body;
    const sql = `INSERT INTO reservas (cliente_nombre, cliente_telefono, cliente_email, prod_codigo, descripcion, prod_cantidad, total_reserva, sucursal_nombre, sucursal_contacto, operador_nombre, comentarios, estado, borrado, local_origen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'En Tránsito', 0, ?)`;
    db.query(sql, [data.cliente_nombre, data.cliente_telefono, data.cliente_email, data.prod_codigo, data.descripcion, data.prod_cantidad, data.total_reserva, data.local_destino, data.contacto_sucursal, data.operador_nombre, data.comentarios, data.local_origen], (err, result) => {
        if (err) return res.status(500).send(err);
        enviarAvisoEmail({ id: result.insertId, ...data, sucursal_nombre: data.local_origen }, 'CONFIRMACION');
        res.send('OK');
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 One Box operativo en puerto ${PORT}`));