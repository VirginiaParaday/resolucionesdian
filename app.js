const express = require('express');
const session = require('express-session');
const methodOverride = require('method-override');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(session({
  secret: 'dian-resoluciones-secret-2024',
  resave: false,
  saveUninitialized: false
}));

app.use('/resoluciones', require('./routes/resoluciones'));
app.use('/terceros', require('./routes/terceros'));
app.get('/', (req, res) => res.redirect('/resoluciones'));

app.listen(PORT, () => {
  console.log(`\n✅ Servidor DIAN Resoluciones corriendo en http://localhost:${PORT}\n`);
});
