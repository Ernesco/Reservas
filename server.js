const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Sirve los archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// CONEXIÓN A LA BASE DE DATOS
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',      
    password: 'Erco2802',      
    database: 'reservas_mo'
});

db.connect(err => {
    if (err) console.error('❌ Error conectando a MySQL:', err);
    else console.log('✅ Conectado a MySQL exitosamente');
});

// 1. GUARDAR NUEVA RESERVA
// Por defecto, nacen con estado 'En Tránsito' y borrado = 0
app.post('/reservar', (req, res) => {
    const { 
        cliente_nombre, cliente_telefono, cliente_email,
        prod_codigo, prod_cantidad,
        sucursal_nombre, sucursal_contacto,
        operador_nombre, comentarios
    } = req.body;
    
    const sql = `
        INSERT INTO reservas 
        (cliente_nombre, cliente_telefono, cliente_email, prod_codigo, prod_cantidad, sucursal_nombre, sucursal_contacto, operador_nombre, comentarios, estado, borrado) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'En Tránsito', 0)
    `;
    
    const valores = [cliente_nombre, cliente_telefono, cliente_email, prod_codigo, prod_cantidad, sucursal_nombre, sucursal_contacto, operador_nombre, comentarios];

    db.query(sql, valores, (err) => {
        if (err) {
            console.error(err);
            res.status(500).send('Error al guardar');
        } else {
            res.send('Guardado OK');
        }
    });
});

// 2. LISTAR RESERVAS (Filtra por sucursal, rol y búsqueda)
app.get('/reservas', (req, res) => {
    const termino = req.query.q || ''; 
    const sucursalUsuario = req.query.sucursal || 'Todas'; 
    const rol = req.query.rol || 'local'; 
    const filtro = `%${termino}%`;

    let sql = `SELECT * FROM reservas WHERE (cliente_nombre LIKE ? OR prod_codigo LIKE ? OR operador_nombre LIKE ?)`;
    let parametros = [filtro, filtro, filtro];

    // Si NO es admin, ocultamos registros marcados como borrados
    if (rol !== 'admin') {
        sql += " AND borrado = 0";
    }

    // Filtro por sucursal (si no es Admin con acceso total)
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

// 3. ACTUALIZAR ESTADO O RESTAURAR REGISTRO
// Esta ruta maneja tanto el cambio de flujo (Pendiente, Retirado) como la restauración (borrado = 0)
app.put('/reservas/:id/estado', (req, res) => {
    const id = req.params.id;
    const { estado, borrado } = req.body;

    let sql, valor;

    // Si recibimos 'borrado', es una acción de restauración
    if (borrado !== undefined) {
        sql = "UPDATE reservas SET borrado = ? WHERE id = ?";
        valor = borrado;
    } else {
        // Si no, es un cambio de estado normal
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

// 4. BORRADO LÓGICO (Ocultar registro)
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

// 5. LOGIN DE USUARIOS
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
app.listen(3000, '0.0.0.0', () => {
    console.log('🚀 Sistema de Reservas funcionando en: http://localhost:3000');
});