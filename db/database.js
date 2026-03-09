require('dotenv').config();
const { Pool } = require('pg');

// Validate DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL no está configurada. La app no puede funcionar sin base de datos.');
  console.error('   En Railway, agrega un servicio PostgreSQL y configura la variable DATABASE_URL.');
  process.exit(1);
}

// Railway sets DATABASE_URL automatically
// Railway internal networking (*.railway.internal) does NOT need SSL
// Only external/public Railway URLs or other cloud hosts need SSL
const dbUrl = process.env.DATABASE_URL;
const isLocal = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');
const isRailwayInternal = dbUrl.includes('.railway.internal');
const needsSSL = !isLocal && !isRailwayInternal;

const pool = new Pool({
  connectionString: dbUrl,
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
  // Connection timeout: 10 seconds
  connectionTimeoutMillis: 10000,
});

// ── Wrapper that keeps the same interface used by routes ──

const db = {};

/**
 * Run a query that doesn't necessarily return rows (INSERT, UPDATE, DELETE).
 * For INSERTs the caller may need `lastID`, so we append RETURNING id when appropriate.
 */
db.runAsync = async (sql, params = []) => {
  // Convert ? placeholders to $1..$N
  const { text, values } = convertPlaceholders(sql, params);
  const res = await pool.query(text, values);
  // Mimic sqlite3's `this` in run callback
  return {
    lastID: res.rows && res.rows.length > 0 && res.rows[0].id !== undefined ? res.rows[0].id : null,
    changes: res.rowCount
  };
};

/**
 * Run a query that returns multiple rows.
 */
db.allAsync = async (sql, params = []) => {
  const { text, values } = convertPlaceholders(sql, params);
  const res = await pool.query(text, values);
  return res.rows;
};

/**
 * Run a query that returns a single row (or undefined).
 */
db.getAsync = async (sql, params = []) => {
  const { text, values } = convertPlaceholders(sql, params);
  const res = await pool.query(text, values);
  return res.rows[0] || undefined;
};

/**
 * Convert SQLite-style `?` placeholders to PostgreSQL `$1, $2, …`
 * Also handles simple SQLite → PG syntax differences.
 */
function convertPlaceholders(sql, params) {
  let idx = 0;
  const text = sql.replace(/\?/g, () => `$${++idx}`);
  return { text, values: params };
}

// ── Table creation with retry logic ──

async function initDatabase(retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    let client;
    try {
      client = await pool.connect();
    } catch (err) {
      console.warn(`⚠️  Intento ${attempt}/${retries} — No se pudo conectar a PostgreSQL: ${err.message}`);
      if (attempt < retries) {
        const waitMs = attempt * 3000; // 3s, 6s, 9s, 12s, 15s
        console.warn(`   Reintentando en ${waitMs / 1000}s...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      console.error('❌ No se pudo conectar a PostgreSQL después de varios intentos.');
      console.error('   Verifica que DATABASE_URL sea correcta y que la BD esté accesible.');
      process.exit(1);
    }

    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS resoluciones (
          id SERIAL PRIMARY KEY,
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
          checked INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS terceros (
          id SERIAL PRIMARY KEY,
          nit TEXT NOT NULL UNIQUE,
          dv TEXT,
          tipo_persona TEXT NOT NULL DEFAULT 'Natural',
          primer_nombre TEXT,
          segundo_nombre TEXT,
          primer_apellido TEXT,
          segundo_apellido TEXT,
          razon_social TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS direcciones_tercero (
          id SERIAL PRIMARY KEY,
          tercero_nit TEXT NOT NULL,
          direccion TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          FOREIGN KEY (tercero_nit) REFERENCES terceros(nit)
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS usuarios (
          id SERIAL PRIMARY KEY,
          usuario TEXT NOT NULL UNIQUE,
          contrasena TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS remember_tokens (
          id SERIAL PRIMARY KEY,
          usuario_id INTEGER NOT NULL,
          token TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        )
      `);

      // Seed default user (IG / 1973) — only if not exists
      const bcrypt = require('bcryptjs');
      const existing = await client.query('SELECT id FROM usuarios WHERE usuario = $1', ['IG']);
      if (existing.rows.length === 0) {
        const hash = bcrypt.hashSync('1973', 10);
        await client.query('INSERT INTO usuarios (usuario, contrasena) VALUES ($1, $2)', ['IG', hash]);
      }

      console.log('✅ Tablas PostgreSQL inicializadas correctamente');
      return; // Success — exit the retry loop
    } catch (err) {
      console.error('Error al inicializar la base de datos:', err.message);
      if (attempt >= retries) process.exit(1);
    } finally {
      if (client) client.release();
    }
  }
}

// Suppress unhandled pool errors (e.g. when PG is unavailable)
pool.on('error', (err) => {
  console.error('Error inesperado en pool PostgreSQL:', err.message);
});

// Run init on require
initDatabase().catch(() => { process.exit(1); });

module.exports = db;
