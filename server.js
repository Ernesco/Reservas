const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const { Resend } = require('resend');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. CONFIGURACIÓN DE RESEND (Segura mediante Variables de Entorno)
// IMPORTANTE: Debes agregar la variable RESEND_API_KEY en el panel de Render
const resend = new Resend(process.env.RESEND_API_KEY); 

// 2. FUNCIÓN AUXILIAR: Enviar Correo
async function enviarAvisoEmail(reserva, tipo) {
    if (!reserva.cliente_email || reserva.cliente_email === '---' || !reserva.cliente_email.includes('@')) {
        console.log(`Reserva #${reserva.id}: Sin email válido. Omitiendo envío.`);
        return;
    }

    let asunto = "";
    let mensajeHtml = "";

    if (tipo === 'CONFIRMACION') {
        asunto = `Confirmación de Reserva #${reserva.id} - En Tránsito`;
        mensajeHtml = `
            <div style="font-family: sans-serif; border: 1px solid #ddd; padding: 20px; border-radius: 10px;">
                <h2 style="color: #4a90e2;">¡Hola ${reserva.cliente_nombre}!</h2>
                <p>Tu reserva ha sido registrada correctamente y ya está <strong>en camino</strong> hacia la sucursal.</p>
                <p><strong>Producto:</strong> ${reserva.descripcion} <br> 
                <strong>Sucursal de retiro:</strong> ${reserva.sucursal_nombre || reserva.local_destino}</p>
                <p>Te avisaremos por este medio cuando llegue al local para que puedas retirarlo.</p>
                <hr>
                <p style="font-size: 12px; color: #777;">Este es un mensaje automático de Reservas MO.</p>
            </div>`;
    } else if (tipo === 'DISPONIBLE') {
        asunto = `¡Tu pedido ya llegó! Reserva #${reserva.id}`;
        mensajeHtml = `
            <div style="font-family: sans-serif; border: 1px solid #a6e3a1; padding: 20px; border-radius: 10px;">
                <h2 style="color: #2e7d32;">¡Buenas noticias, ${reserva.cliente_nombre}!</h2>
                <p>Tu producto <strong>${reserva.descripcion}</strong> ya se encuentra disponible en la sucursal <strong>${reserva.sucursal_nombre}</strong>.</p>
                <p>Puedes pasar a retirarlo en el horario habitual del local.</p>
                <p>¡Te esperamos!</p>
                <hr>
                <p style="font-size: 12px; color: #777;">Este es un mensaje automático de Reservas MO.</p>
            </div>`;
    }

    try {
        await resend.emails.send({
            // Esto hará que el cliente vea "Reservas MO" como remitente
            from: 'Reservas MO <onboarding@resend.dev>', 
            to: reserva.cliente_email,
            subject: asunto,
            html: mensajeHtml,
        });
        console.log("✅ Email enviado vía API Resend a:", reserva.cliente_email);
    } catch (error) {
        console.error("❌ Error al enviar vía Resend:", error);
    }
}

// 3. CONFIGURACIÓN DB (TiDB)
const db = mysql.createPool({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: process.env.MYSQLPORT || 4000,
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// --- RUTAS ---

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
        if (err) {
            console.error("Error al guardar:", err);
            res.status(500).send('Error');
        } else {
            enviarAvisoEmail({ id: result.insertId, ...data, sucursal_nombre: data.local_destino }, 'CONFIRMACION');
            res.send('Guardado OK');
        }
    });
});

app.get('/reservas', (req, res) => {
    const termino = req.query.q || ''; 
    const sucursalUsuario = req.query.sucursal ? req.query.sucursal.trim() : ''; 
    const rol = req.query.rol ? req.query.rol.trim().toLowerCase() : 'local'; 
    const filtroBusqueda = `%${termino}%`;

    let sql = `SELECT * FROM reservas WHERE (cliente_nombre LIKE ? OR prod_codigo LIKE ? OR operador_nombre LIKE ? OR local_origen LIKE ?)`;
    let parametros = [filtroBusqueda, filtroBusqueda, filtroBusqueda, filtroBusqueda];

    if (rol !== 'admin') {
        sql += " AND local_origen = ? AND borrado = 0";
        parametros.push(sucursalUsuario);
    }

    sql += " ORDER BY id DESC";

    db.query(sql, parametros, (err, results) => {
        if (err) {
            console.error("Error en query:", err);
            res.status(500).send('Error al leer datos');
        } else {
            res.json(results);
        }
    });
});

app.put('/reservas/:id/estado', (req, res) => {
    const id = req.params.id;
    const { estado, borrado, responsable } = req.body;

    if (borrado !== undefined) {
        const sqlRestaurar = "UPDATE reservas SET borrado = ?, estado = ? WHERE id = ?";
        db.query(sqlRestaurar, [borrado, estado, id], (err) => {
            if (err) return res.status(500).send('Error');
            res.send('OK');
        });
    } else {
        let campoResponsable = "";
        let valores = [estado];

        if (estado === 'Pendiente de Retiro') {
            campoResponsable = ", responsable_recibo = ?";
            valores.push(responsable);
        } else if (estado === 'Retirado' || estado === 'Cancelado') {
            campoResponsable = ", responsable_finalizado = ?";
            valores.push(responsable);
        }

        valores.push(id);
        const sql = `UPDATE reservas SET estado = ? ${campoResponsable} WHERE id = ?`;

        db.query(sql, valores, (err) => {
            if (err) {
                console.error(err);
                res.status(500).send('Error');
            } else {
                if (estado === 'Pendiente de Retiro') {
                    db.query("SELECT * FROM reservas WHERE id = ?", [id], (err, results) => {
                        if (!err && results.length > 0) {
                            enviarAvisoEmail(results[0], 'DISPONIBLE');
                        }
                    });
                }
                res.send('OK');
            }
        });
    }
});

app.delete('/reservas/:id', (req, res) => {
    const id = req.params.id;
    db.query("UPDATE reservas SET borrado = 1 WHERE id = ?", [id], (err) => {
        if (err) res.status(500).send('Error');
        else res.send('OK');
    });
});

app.delete('/reservas_definitivas/:id', (req, res) => {
    const id = req.params.id;
    const sqlRespaldo = "INSERT INTO borrados_definitivos SELECT * FROM reservas WHERE id = ?";
    db.query(sqlRespaldo, [id], (err) => {
        if (err) return res.status(500).send('Error al respaldar');
        db.query("DELETE FROM reservas WHERE id = ?", [id], (err) => {
            if (err) return res.status(500).send('Error al eliminar');
            res.send('Eliminado permanentemente');
        });
    });
});

app.post('/login', (req, res) => {
    const { usuario, password } = req.body;
    db.query("SELECT * FROM usuarios WHERE usuario = ? AND password = ?", [usuario, password], (err, results) => {
        if (err) return res.status(500).send('Error');
        if (results.length > 0) {
            res.json({
                success: true,
                nombre: results[0].usuario,
                rol: results[0].rol,
                sucursal: results[0].sucursal 
            });
        } else {
            res.json({ success: false, message: 'Usuario o clave incorrectos' });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Sistema funcionando en puerto ${PORT}`);
});