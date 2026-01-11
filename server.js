const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

// CONFIGURACIÓN PARA LA NUBE
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

db.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Error conectando a TiDB:', err.message);
        return;
    }
    console.log('✅ Conexión exitosa a TiDB Cloud');
    connection.release();
});

// --- RUTA: BUSCAR PRODUCTO POR CÓDIGO ---
app.get('/productos/:codigo', (req, res) => {
    const { codigo } = req.params;
    const sql = "SELECT descripcion, precio_unitario FROM productos WHERE codigo = ?";
    db.query(sql, [codigo], (err, results) => {
        if (err) return res.status(500).send('Error');
        if (results.length > 0) res.json(results[0]);
        else res.status(404).send('No encontrado');
    });
});

// 1. GUARDAR NUEVA RESERVA
app.post('/reservar', (req, res) => {
    const { 
        cliente_nombre, cliente_telefono, cliente_email,
        prod_codigo, descripcion, prod_cantidad, total_reserva,
        local_destino, contacto_sucursal,
        local_origen, operador_nombre, comentarios 
    } = req.body;
    
    const sql = `
        INSERT INTO reservas 
        (cliente_nombre, cliente_telefono, cliente_email, prod_codigo, descripcion, prod_cantidad, total_reserva, sucursal_nombre, sucursal_contacto, operador_nombre, comentarios, estado, borrado, local_origen) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'En Tránsito', 0, ?)
    `;
    
    const valores = [
        cliente_nombre, cliente_telefono, cliente_email, 
        prod_codigo, descripcion, prod_cantidad, total_reserva, 
        local_destino, contacto_sucursal, 
        operador_nombre, comentarios, local_origen 
    ];

    db.query(sql, valores, (err) => {
        if (err) { console.error("Error al guardar:", err); res.status(500).send('Error'); }
        else res.send('Guardado OK');
    });
});

// 2. LISTAR RESERVAS (ACTUALIZADO: Búsqueda por LOCAL para Admin)
app.get('/reservas', (req, res) => {
    const termino = req.query.q || ''; 
    const sucursalUsuario = req.query.sucursal ? req.query.sucursal.trim() : ''; 
    const rol = req.query.rol ? req.query.rol.trim().toLowerCase() : 'local'; 
    const filtroBusqueda = `%${termino}%`;

    // Mejorado: Ahora el buscador también filtra por 'local_origen' para que el Admin encuentre por sucursal
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

// 3. ACTUALIZAR ESTADO O RESTAURAR (Con Trazabilidad)
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
            if (err) { console.error(err); res.status(500).send('Error'); }
            else res.send('OK');
        });
    }
});

// 4. BORRADO LÓGICO
app.delete('/reservas/:id', (req, res) => {
    const id = req.params.id;
    db.query("UPDATE reservas SET borrado = 1 WHERE id = ?", [id], (err) => {
        if (err) res.status(500).send('Error');
        else res.send('OK');
    });
});

// 5. ELIMINACIÓN DEFINITIVA
app.delete('/reservas_definitivas/:id', (req, res) => {
    const id = req.params.id;
    const sqlRespaldo = "INSERT INTO borrados_definitivos SELECT * FROM reservas WHERE id = ?";
    
    db.query(sqlRespaldo, [id], (err) => {
        if (err) {
            console.error("Error al respaldar:", err);
            return res.status(500).send('Error al respaldar reserva');
        }
        db.query("DELETE FROM reservas WHERE id = ?", [id], (err) => {
            if (err) return res.status(500).send('Error al eliminar');
            res.send('Eliminado permanentemente y respaldado en SQL');
        });
    });
});

// 6. LOGIN
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