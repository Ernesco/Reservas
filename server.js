const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Sirve los archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// CONFIGURACIÓN PARA LA NUBE
const db = mysql.createPool({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: process.env.MYSQLPORT || 4000,
    ssl: {
        rejectUnauthorized: false 
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Prueba de conexión inicial
db.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Error conectando a TiDB:', err.message);
        return;
    }
    console.log('✅ Conexión exitosa a TiDB Cloud');
    connection.release();
});

// --- NUEVA RUTA: BUSCAR PRODUCTO POR CÓDIGO ---
app.get('/productos/:codigo', (req, res) => {
    const { codigo } = req.params;
    const sql = "SELECT descripcion, precio_unitario FROM productos WHERE codigo = ?";

    db.query(sql, [codigo], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error al buscar producto');
        }
        if (results.length > 0) {
            res.json(results[0]);
        } else {
            res.status(404).send('Producto no encontrado');
        }
    });
});

// 1. GUARDAR NUEVA RESERVA (Actualizado con total_reserva)
app.post('/reservar', (req, res) => {
    const { 
        cliente_nombre, cliente_telefono, cliente_email,
        prod_codigo, prod_cantidad, total_reserva, // Nuevo campo
        sucursal_nombre, sucursal_contacto,
        operador_nombre, comentarios
    } = req.body;
    
    const sql = `
        INSERT INTO reservas 
        (cliente_nombre, cliente_telefono, cliente_email, prod_codigo, prod_cantidad, total_reserva, sucursal_nombre, sucursal_contacto, operador_nombre, comentarios, estado, borrado) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'En Tránsito', 0)
    `;
    
    const valores = [
        cliente_nombre, cliente_telefono, cliente_email, 
        prod_codigo, prod_cantidad, total_reserva, 
        sucursal_nombre, sucursal_contacto, 
        operador_nombre, comentarios
    ];

    db.query(sql, valores, (err) => {
        if (err) { 
            console.error(err); 
            res.status(500).send('Error al guardar la reserva'); 
        } else {
            res.send('Guardado OK');
        }
    });
});

// 2. LISTAR RESERVAS
app.get('/reservas', (req, res) => {
    const termino = req.query.q || ''; 
    const sucursalUsuario = req.query.sucursal || 'Todas'; 
    const rol = req.query.rol || 'local'; 
    const filtro = `%${termino}%`;

    let sql = `SELECT * FROM reservas WHERE (cliente_nombre LIKE ? OR prod_codigo LIKE ? OR operador_nombre LIKE ?)`;
    let parametros = [filtro, filtro, filtro];

    if (rol !== 'admin') {
        sql += " AND borrado = 0";
    }

    if (sucursalUsuario !== 'Todas') {
        sql += " AND sucursal_nombre = ?";
        parametros.push(sucursalUsuario);
    }

    sql += " ORDER BY id DESC";

    db.query(sql, parametros, (err, results) => {
        if (err) {
            console.error(err);
            res.status(500).send('Error al leer datos');
        } else {
            res.json(results);
        }
    });
});

// 3. ACTUALIZAR ESTADO O RESTAURAR
app.put('/reservas/:id/estado', (req, res) => {
    const id = req.params.id;
    const { estado, borrado } = req.body;
    let sql, valor;

    if (borrado !== undefined) {
        sql = "UPDATE reservas SET borrado = ? WHERE id = ?";
        valor = borrado;
    } else {
        sql = "UPDATE reservas SET estado = ? WHERE id = ?";
        valor = estado;
    }

    db.query(sql, [valor, id], (err) => {
        if (err) {
            console.error(err);
            res.status(500).send('Error al actualizar');
        } else {
            res.send('Actualizado correctamente');
        }
    });
});

// 4. BORRADO LÓGICO
app.delete('/reservas/:id', (req, res) => {
    const id = req.params.id;
    const sql = "UPDATE reservas SET borrado = 1 WHERE id = ?";
    
    db.query(sql, [id], (err) => {
        if (err) {
            console.error(err);
            res.status(500).send('Error al marcar como borrado');
        } else {
            res.send('Registro enviado a eliminados');
        }
    });
});

// 5. LOGIN
app.post('/login', (req, res) => {
    const { usuario, password } = req.body;
    const sql = "SELECT * FROM usuarios WHERE usuario = ? AND password = ?";

    db.query(sql, [usuario, password], (err, results) => {
        if (err) {
            console.error(err);
            res.status(500).send('Error del servidor');
            return;
        }
        if (results.length > 0) {
            const encontrado = results[0];
            res.json({
                success: true,
                nombre: encontrado.usuario,
                rol: encontrado.rol,
                sucursal: encontrado.sucursal 
            });
        } else {
            res.json({ success: false, message: 'Usuario o clave incorrectos' });
        }
    });
});

// INICIAR SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Sistema funcionando en puerto ${PORT}`);
});