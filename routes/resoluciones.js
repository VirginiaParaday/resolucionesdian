const express = require('express');
const router = express.Router();
const db = require('../db/database');

// List all
router.get('/', async (req, res) => {
  const search = req.query.search || '';
  const modalidad = req.query.modalidad || '';
  const solicitud = req.query.solicitud || '';

  let query = 'SELECT * FROM resoluciones WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND (nit LIKE ? OR nombre_tercero LIKE ? OR numero_resolucion LIKE ? OR prefijo LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (modalidad) { query += ' AND modalidad = ?'; params.push(modalidad); }
  if (solicitud) { query += ' AND solicitud = ?'; params.push(solicitud); }
  query += ' ORDER BY created_at DESC';

  try {
    const resoluciones = await db.allAsync(query, params);
    const totalRow = await db.getAsync('SELECT COUNT(*) as cnt FROM resoluciones');
    const allRows = await db.allAsync('SELECT solicitud, fecha_resolucion, vigencia FROM resoluciones');
    const countBySolicitud = (tipo) => allRows.filter(r => r.solicitud === tipo).length;

    // Compute expiration stats
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    let vencidasTotal = 0, vencidasHoy = 0, porVencer1 = 0, porVencer5 = 0, porVencer15 = 0, enVencimiento = 0;

    allRows.forEach(r => {
      if (!r.fecha_resolucion || !r.vigencia) return;
      const mv = parseInt(r.vigencia);
      if (isNaN(mv)) return;
      const fv = new Date(r.fecha_resolucion + 'T00:00:00');
      fv.setMonth(fv.getMonth() + mv);
      fv.setHours(0, 0, 0, 0);
      const diffDias = Math.ceil((fv - hoy) / (1000 * 60 * 60 * 24));

      if (diffDias < 0) vencidasTotal++;
      if (diffDias === 0) vencidasHoy++;
      if (diffDias === 1) porVencer1++;
      if (diffDias > 0 && diffDias <= 5) porVencer5++;
      if (diffDias > 0 && diffDias <= 15) porVencer15++;
      if (diffDias >= 0 && diffDias <= 15) enVencimiento++;
    });

    res.render('index', {
      resoluciones,
      search, modalidad, solicitud,
      total: totalRow.cnt,
      totalAuth: countBySolicitud('Autorización'),
      totalHab: countBySolicitud('Habilitación'),
      totalInhab: countBySolicitud('Inhabilitación'),
      vencidasTotal, vencidasHoy, porVencer1, porVencer5, porVencer15, enVencimiento,
      message: req.session.message || null
    });
    req.session.message = null;
  } catch (e) {
    res.status(500).send('Error al cargar resoluciones: ' + e.message);
  }
});

// New form
router.get('/nueva', (req, res) => {
  res.render('form', { resolucion: null, action: '/resoluciones', method: 'POST', title: 'Nueva Resolución' });
});

// Create
router.post('/', async (req, res) => {
  const { nit, nombre_tercero, fecha_resolucion, numero_resolucion, modalidad, solicitud, prefijo, sucursal, desde, hasta, vigencia } = req.body;
  try {
    await db.runAsync(
      `INSERT INTO resoluciones (nit, nombre_tercero, fecha_resolucion, numero_resolucion, modalidad, solicitud, prefijo, sucursal, desde, hasta, vigencia)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nit, nombre_tercero, fecha_resolucion, numero_resolucion, modalidad, solicitud, prefijo || '', sucursal || '', desde, hasta, vigencia]
    );
    req.session.message = { type: 'success', text: 'Resolución registrada exitosamente.' };
  } catch (e) {
    req.session.message = { type: 'error', text: 'Error al registrar: ' + e.message };
  }
  res.redirect('/resoluciones');
});

// Show detail
router.get('/:id', async (req, res) => {
  try {
    const resolucion = await db.getAsync('SELECT * FROM resoluciones WHERE id = ?', [req.params.id]);
    if (!resolucion) return res.redirect('/resoluciones');
    res.render('detail', { resolucion });
  } catch (e) {
    res.redirect('/resoluciones');
  }
});

// Edit form
router.get('/:id/editar', async (req, res) => {
  try {
    const resolucion = await db.getAsync('SELECT * FROM resoluciones WHERE id = ?', [req.params.id]);
    if (!resolucion) return res.redirect('/resoluciones');
    res.render('form', {
      resolucion,
      action: `/resoluciones/${req.params.id}?_method=PUT`,
      method: 'POST',
      title: 'Editar Resolución'
    });
  } catch (e) {
    res.redirect('/resoluciones');
  }
});

// Update
router.put('/:id', async (req, res) => {
  const { nit, nombre_tercero, fecha_resolucion, numero_resolucion, modalidad, solicitud, prefijo, sucursal, desde, hasta, vigencia } = req.body;
  try {
    await db.runAsync(
      `UPDATE resoluciones SET nit=?, nombre_tercero=?, fecha_resolucion=?, numero_resolucion=?,
       modalidad=?, solicitud=?, prefijo=?, sucursal=?, desde=?, hasta=?, vigencia=?,
       updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [nit, nombre_tercero, fecha_resolucion, numero_resolucion, modalidad, solicitud, prefijo || '', sucursal || '', desde, hasta, vigencia, req.params.id]
    );
    req.session.message = { type: 'success', text: 'Resolución actualizada exitosamente.' };
  } catch (e) {
    req.session.message = { type: 'error', text: 'Error al actualizar: ' + e.message };
  }
  res.redirect('/resoluciones');
});

// Delete
router.delete('/:id', async (req, res) => {
  try {
    await db.runAsync('DELETE FROM resoluciones WHERE id = ?', [req.params.id]);
    req.session.message = { type: 'success', text: 'Resolución eliminada.' };
  } catch (e) {
    req.session.message = { type: 'error', text: 'Error al eliminar: ' + e.message };
  }
  res.redirect('/resoluciones');
});

module.exports = router;
