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

// FUNCIÓN AUXILIAR: Enviar Correo
async function enviarAvisoEmail(reserva, tipo) {
    let asunto = "";
    let mensajeHtml = "";
    let destinatario = reserva.cliente_email;
    
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
                        <p>Te avisaremos por este medio y por Wathsapp cuando puedas pasar a retirarla</p>
                        ${footerHtml}`;
    } else if (tipo === 'DISPONIBLE') {
        asunto = `¡Tu pedido ya llegó! Reserva #${reserva.id}`;
        mensajeHtml = `<div style="font-family: sans-serif; border: 1px solid #a6e3a1; padding: 20px;">
            <h2>¡Buenas noticias, ${reserva.cliente_nombre}!</h2>
            <p>Tu reserva: <strong>${reserva.descripcion}</strong> ya está en <strong>${reserva.sucursal_nombre}</strong>.</p>
            <p>Te esperamos!</p>
            <p>📍 Dirección: ${infoSucursal.direccion}<br>⏰ Horarios: ${infoSucursal.horarios}</p>
            </div>${footerHtml}`;
    } else if (tipo === 'SOPORTE') {
        destinatario = 'erco.efc@gmail.com'; 
        asunto = `🛠️ Soporte: ${reserva.tipo_ticket}`;
        mensajeHtml = `<h2>Nuevo Ticket</h2><p><strong>De:</strong> ${reserva.usuario}</p><p><strong>Mensaje:</strong> ${reserva.descripcion_ticket}</p>${footerHtml}`;
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

// --- RUTAS DE RESERVAS ---

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
        db.query("UPDATE reservas SET borrado = ?, estado = ? WHERE id = ?", [borrado, estado, id], (err) => {
            if (err) return res.status(500).send('Error');
            res.send('OK');
        });
    } else {
        let sqlUpdate = "";
        let valores = [];

        if (estado === 'Pendiente de Retiro') {
            sqlUpdate = `UPDATE reservas SET estado = ?, responsable_recibo = ?, fecha_ingreso = NOW() WHERE id = ?`;
            valores = [estado, responsable, id];
        } else if (estado === 'Retirado' || estado === 'Cancelado') {
            sqlUpdate = `UPDATE reservas SET estado = ?, responsable_finalizado = ?, fecha_cierre = NOW() WHERE id = ?`;
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

// --- RUTA DE EDICIÓN CORREGIDA PARA GUARDAR TODOS LOS CAMPOS ---
app.put('/reservas/:id/editar', (req, res) => {
    const id = req.params.id;
    const { 
        cliente_nombre, 
        cliente_telefono, 
        cliente_email, 
        prod_codigo, 
        descripcion, 
        prod_cantidad, 
        total_reserva 
    } = req.body;

    const sql = `
        UPDATE reservas 
        SET cliente_nombre = ?, 
            cliente_telefono = ?, 
            cliente_email = ?, 
            prod_codigo = ?, 
            descripcion = ?, 
            prod_cantidad = ?, 
            total_reserva = ? 
        WHERE id = ?`;

    db.query(sql, [
        cliente_nombre, 
        cliente_telefono, 
        cliente_email, 
        prod_codigo, 
        descripcion, 
        prod_cantidad, 
        total_reserva, 
        id
    ], (err, result) => {
        if (err) {
            console.error("Error al editar reserva en MySQL:", err);
            return res.status(500).send('Error al actualizar');
        }
        res.send('OK');
    });
});

app.get('/reservas', (req, res) => {
    const { q, sucursal, rol } = req.query;
    let sql = `
        SELECT r.*, 
        (SELECT direccion FROM usuarios WHERE sucursal = r.local_origen LIMIT 1) as direccion,
        (SELECT horarios FROM usuarios WHERE sucursal = r.local_origen LIMIT 1) as horarios
        FROM reservas r
        WHERE (r.cliente_nombre LIKE ? OR r.prod_codigo LIKE ?)
    `;
    let par = [`%${q}%`, `%${q}%`];
    if (rol !== 'admin') { 
        sql += " AND r.local_origen = ?"; 
        par.push(sucursal); 
    }
    sql += " ORDER BY r.id DESC";

    db.query(sql, par, (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

// --- OTRAS RUTAS ---

app.delete('/admin/reservas-eliminar/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const sqlInsert = `
            INSERT INTO borrados_definitivos (
                id, fecha_registro, cliente_nombre, cliente_telefono, cliente_email,
                prod_codigo, descripcion, prod_cantidad, total_reserva, 
                local_origen, operador_nombre, responsable_recibo, 
                responsable_finalizado, estado
            )
            SELECT 
                id, fecha_registro, cliente_nombre, cliente_telefono, cliente_email,
                prod_codigo, descripcion, prod_cantidad, total_reserva, 
                local_origen, operador_nombre, responsable_recibo, 
                responsable_finalizado, estado
            FROM reservas 
            WHERE id = ?`;

        const [resCopia] = await db.promise().query(sqlInsert, [id]);
        if (resCopia.affectedRows > 0) {
            await db.promise().query("DELETE FROM reservas WHERE id = ?", [id]);
            res.send('OK');
        } else {
            res.status(404).send('No encontrada');
        }
    } catch (err) {
        console.error("Error al archivar:", err);
        res.status(500).send('Error');
    }
});

app.post('/admin/actualizar-precios', upload.single('archivoCsv'), async (req, res) => {
    const rolUsuario = req.headers['user-role'];
    if (rolUsuario !== 'admin') return res.status(403).json({ success: false });
    if (!req.file) return res.status(400).json({ success: false });

    const resultados = [];
    fs.createReadStream(req.file.path)
        .pipe(csv({ separator: undefined })) 
        .on('data', (data) => {
            const filaLimpia = {};
            for (let key in data) {
                const nuevaLlave = key.trim().replace(/^\uFEFF/, '').toLowerCase();
                filaLimpia[nuevaLlave] = data[key].trim();
            }
            resultados.push(filaLimpia);
        })
        .on('end', async () => {
            try {
                let contador = 0;
                for (const fila of resultados) {
                    const codigo = fila.codigo || fila.cod;
                    const precio = fila.precio_unitario || fila.precio;
                    if (codigo && precio) {
                        const [resUpdate] = await db.promise().query(
                            "UPDATE productos SET precio_unitario = ? WHERE codigo = ?",
                            [precio.replace(',', '.'), codigo]
                        );
                        if (resUpdate.affectedRows > 0) contador++;
                    }
                }
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                res.json({ success: true, count: contador });
            } catch (err) { res.status(500).json({ success: false }); }
        });
});

app.post('/admin/soporte', async (req, res) => {
    const { tipo, mensaje, usuario } = req.body;
    try {
        await enviarAvisoEmail({ tipo_ticket: tipo, descripcion_ticket: mensaje, usuario: usuario }, 'SOPORTE');
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.get('/admin/usuarios', (req, res) => {
    db.query("SELECT * FROM usuarios ORDER BY sucursal ASC", (err, results) => {
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