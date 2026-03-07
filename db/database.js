const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const dbPath = path.join(dbDir, 'resoluciones.db');
const db = new sqlite3.Database(dbPath);

// Promisify helpers para usar con async/await o callbacks simples
db.runAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve(this);
  });
});

db.allAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

db.getAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

// Crear tablas si no existen
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS resoluciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nit TEXT NOT NULL,
      nombre_tercero TEXT NOT NULL,
      fecha_resolucion TEXT NOT NULL,
      numero_resolucion TEXT NOT NULL,
      modalidad TEXT NOT NULL,
      solicitud TEXT NOT NULL,
      prefijo TEXT,
      sucursal TEXT,
      desde TEXT NOT NULL,
      hasta TEXT NOT NULL,
      vigencia TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS terceros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nit TEXT NOT NULL UNIQUE,
      dv TEXT,
      tipo_persona TEXT NOT NULL DEFAULT 'Natural',
      primer_nombre TEXT,
      segundo_nombre TEXT,
      primer_apellido TEXT,
      segundo_apellido TEXT,
      razon_social TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS direcciones_tercero (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tercero_nit TEXT NOT NULL,
      direccion TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tercero_nit) REFERENCES terceros(nit)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT NOT NULL UNIQUE,
      contrasena TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS remember_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )
  `);

  // Seed default user (IG / 1973) — only if not exists
  const bcrypt = require('bcrypt');
  db.get(`SELECT id FROM usuarios WHERE usuario = ?`, ['IG'], (err, row) => {
    if (!row) {
      const hash = bcrypt.hashSync('1973', 10);
      db.run(`INSERT INTO usuarios (usuario, contrasena) VALUES (?, ?)`, ['IG', hash]);
    }
  });
});

module.exports = db;
