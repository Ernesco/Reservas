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

// Configuración de Multer para subida temporal de archivos (CSV de precios)
const upload = multer({ dest: 'uploads/' });

// 1. CONFIGURACIÓN DE RESEND
const resend = new Resend(process.env.RESEND_API_KEY); 

// 2. CONFIGURACIÓN DB (Pool de conexiones)
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

// 3. FUNCIÓN AUXILIAR: Enviar Correo (Ahora busca info en tabla USUARIOS)
async function enviarAvisoEmail(reserva, tipo) {
    let asunto = "";
    let mensajeHtml = "";
    let destinatario = reserva.cliente_email;
    
    if (tipo !== 'SOPORTE') {
        if (!destinatario || destinatario === '---' || !destinatario.includes('@')) return;
    }

    // Unificación: Buscamos dirección y horarios en la tabla USUARIOS filtrando por sucursal
    let infoSucursal = { horarios: "Consultar en local", direccion: "Dirección habitual", contacto_tel: "" };
    if (tipo === 'DISPONIBLE') {
        try {
            const [rows] = await db.promise().query(
                "SELECT direccion, horarios, contacto_tel FROM usuarios WHERE sucursal = ? LIMIT 1", 
                [reserva.sucursal_nombre]
            );
            if (rows.length > 0) infoSucursal = rows[0];
        } catch (err) {
            console.error("Error al obtener info de local desde tabla usuarios:", err);
        }
    }

    const footerHtml = `<br><hr><footer style="color: #666; font-family: sans-serif;"><p>One Box - Gestión de Reservas</p></footer>`;

    if (tipo === 'CONFIRMACION') {
        asunto = `Confirmación de Reserva #${reserva.id} - En Tránsito`;
        mensajeHtml = `<h2>¡Hola ${reserva.cliente_nombre}!</h2><p>Tu reserva de ${reserva.descripcion} está en camino.</p>${footerHtml}`;
    } else if (tipo === 'DISPONIBLE') {
        asunto = `¡Tu pedido ya llegó! Reserva #${reserva.id}`;
        mensajeHtml = `<div style="font-family: sans-serif; border: 1px solid #a6e3a1; padding: 20px;">
            <h2>¡Buenas noticias, ${reserva.cliente_nombre}!</h2>
            <p>Retirá tu <strong>${reserva.descripcion}</strong> en <strong>${reserva.sucursal_nombre}</strong>.</p>
            <p>📍 Dirección: ${infoSucursal.direccion}<br>⏰ Horarios: ${infoSucursal.horarios}</p>
            </div>${footerHtml}`;
    } else if (tipo === 'SOPORTE') {
        destinatario = 'erco.efc@gmail.com'; 
        asunto = `🛠️ Soporte: ${reserva.tipo_ticket} - ${reserva.usuario}`;
        mensajeHtml = `<h2>Nuevo Ticket</h2><p><strong>De:</strong> ${reserva.usuario}</p><p>${reserva.descripcion_ticket}</p>${footerHtml}`;
    }

    try {
        await resend.emails.send({
            from: 'One Box <sistema@onebox.net.ar>', 
            to: destinatario,
            subject: asunto,
            html: mensajeHtml,
        });
    } catch (error) { console.error("Error mail:", error); }
}

// --- RUTA: ACTUALIZACIÓN MASIVA DE PRECIOS ---
app.post('/admin/actualizar-precios', upload.single('archivoCsv'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'Archivo no recibido.' });

    const resultados = [];
    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => resultados.push(data))
        .on('end', async () => {
            try {
                let contador = 0;
                for (const fila of resultados) {
                    if (fila.codigo && fila.precio_unitario) {
                        await db.promise().query(
                            "UPDATE productos SET precio_unitario = ? WHERE codigo = ?",
                            [fila.precio_unitario, fila.codigo]
                        );
                        contador++;
                    }
                }
                fs.unlinkSync(req.file.path); // Borrar temporal
                res.json({ success: true, count: contador });
            } catch (err) {
                res.status(500).json({ success: false, message: 'Error en base de datos' });
            }
        });
});

// --- RUTA: SOPORTE TÉCNICO ---
app.post('/admin/soporte', async (req, res) => {
    const { tipo, mensaje, usuario } = req.body;
    try {
        await enviarAvisoEmail({ tipo_ticket: tipo, descripcion_ticket: mensaje, usuario: usuario }, 'SOPORTE');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// --- RUTAS DE USUARIOS (TABLA UNIFICADA) ---
app.get('/admin/usuarios', (req, res) => {
    db.query("SELECT * FROM usuarios ORDER BY sucursal ASC", (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

app.post('/admin/usuarios', (req, res) => {
    const { id, usuario, password, rol, sucursal, direccion, horarios, contacto_tel } = req.body;
    if (id) {
        const sql = "UPDATE usuarios SET usuario=?, password=?, rol=?, sucursal=?, direccion=?, horarios=?, contacto_tel=? WHERE id=?";
        db.query(sql, [usuario, password, rol, sucursal, direccion, horarios, contacto_tel, id], (err) => {
            if (err) return res.status(500).json({message: "Error al actualizar"});
            res.send("OK");
        });
    } else {
        const sql = "INSERT INTO usuarios (usuario, password, rol, sucursal, direccion, horarios, contacto_tel) VALUES (?, ?, ?, ?, ?, ?, ?)";
        db.query(sql, [usuario, password, rol, sucursal, direccion, horarios, contacto_tel], (err) => {
            if (err) return res.status(500).json({message: "Usuario ya existe"});
            res.send("OK");
        });
    }
});

app.delete('/admin/usuarios/:id', (req, res) => {
    db.query("DELETE FROM usuarios WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).send(err);
        res.send("OK");
    });
});

// --- RUTAS DE RESERVAS Y LOGIN (Iguales a las tuyas) ---
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

app.get('/reservas', (req, res) => {
    const { q, sucursal, rol } = req.query;
    let sql = "SELECT * FROM reservas WHERE (cliente_nombre LIKE ? OR prod_codigo LIKE ?)";
    let par = [`%${q}%`, `%${q}%`];
    if (rol !== 'admin') { sql += " AND local_origen = ?"; par.push(sucursal); }
    sql += " ORDER BY id DESC";
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
        } else {
            res.json({ success: false, message: 'Credenciales inválidas' });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 One Box listo en puerto ${PORT}`));