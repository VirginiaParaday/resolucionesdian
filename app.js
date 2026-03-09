require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const db = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(cookieParser('dian-resoluciones-cookie-secret'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(session({
  secret: 'dian-resoluciones-secret-2024',
  resave: false,
  saveUninitialized: false
}));

// ---- AUTH MIDDLEWARE ----

// Auto-login from remember_me cookie if session not active
async function autoLogin(req, res, next) {
  if (req.session && req.session.autenticado) return next();
  const token = req.cookies && req.cookies.remember_me;
  if (!token) return next();
  try {
    const row = await db.getAsync(
      `SELECT rt.usuario_id, u.usuario FROM remember_tokens rt
       JOIN usuarios u ON u.id = rt.usuario_id
       WHERE rt.token = ? AND rt.expires_at > NOW()`,
      [token]
    );
    if (row) {
      req.session.autenticado = true;
      req.session.usuario = row.usuario;
      req.session.usuario_id = row.usuario_id;
    } else {
      // Token expired or invalid — clear cookie
      res.clearCookie('remember_me');
    }
  } catch (e) {
    // Ignore DB errors on auto-login
  }
  next();
}

app.use(autoLogin);

function requireAuth(req, res, next) {
  if (req.session && req.session.autenticado) return next();
  res.redirect('/login');
}

// ---- LOGIN ----
app.get('/login', (req, res) => {
  if (req.session && req.session.autenticado) return res.redirect('/resoluciones');
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { usuario, contrasena, recordarme } = req.body;
  try {
    const user = await db.getAsync(`SELECT * FROM usuarios WHERE usuario = ?`, [usuario]);
    if (!user) {
      return res.render('login', { error: 'Usuario o contraseña incorrectos.' });
    }
    const valid = await bcrypt.compare(contrasena, user.contrasena);
    if (!valid) {
      return res.render('login', { error: 'Usuario o contraseña incorrectos.' });
    }

    // Session
    req.session.autenticado = true;
    req.session.usuario = user.usuario;
    req.session.usuario_id = user.id;

    // Remember me — generate token, save in DB + cookie
    if (recordarme) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
      await db.runAsync(
        `INSERT INTO remember_tokens (usuario_id, token, expires_at) VALUES (?, ?, ?)`,
        [user.id, token, expiresAt.toISOString()]
      );
      res.cookie('remember_me', token, {
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        signed: false
      });
    }

    return res.redirect('/resoluciones');
  } catch (err) {
    console.error('Error en login:', err);
    res.render('login', { error: 'Error interno del servidor.' });
  }
});

// ---- LOGOUT ----
app.get('/logout', async (req, res) => {
  // Delete remember token from DB
  const token = req.cookies && req.cookies.remember_me;
  if (token) {
    try {
      await db.runAsync(`DELETE FROM remember_tokens WHERE token = ?`, [token]);
    } catch (e) { /* ignore */ }
    res.clearCookie('remember_me');
  }
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Protected routes
app.use('/resoluciones', requireAuth, require('./routes/resoluciones'));
app.use('/terceros', requireAuth, require('./routes/terceros'));
app.get('/', (req, res) => res.redirect(req.session && req.session.autenticado ? '/resoluciones' : '/login'));

app.listen(PORT, () => {
  console.log(`\n✅ Servidor DIAN Resoluciones corriendo en http://localhost:${PORT}\n`);
});
