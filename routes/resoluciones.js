const express = require('express');
const router = express.Router();
const db = require('../db/database');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const path = require('path');
const fs = require('fs');

// Multer config for PDF uploads
const uploadPdf = multer({
  dest: path.join(__dirname, '..', 'tmp'),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Solo se permiten archivos PDF'), false);
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

// Helper: map solicitud text to known values
function mapearSolicitud(valor) {
  const v = (valor || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (v.includes('inhabilitacion')) return 'Inhabilitación';
  if (v.includes('habilitacion')) return 'Habilitación';
  if (v.includes('autorizacion')) return 'Autorización';
  return valor;
}

// Helper: map modalidad text to known form select values
function mapearModalidad(valor) {
  const v = (valor || '').toLowerCase();
  if (v.includes('electr')) return 'Factura electrónica de venta';
  if (v.includes('computador')) return 'Facturación computador';
  if (v.includes('talonario') || (v.includes('factura') && v.includes('papel'))) return 'Factura de talonario o de papel';
  if (v.includes('pos') || v.includes('d.e')) return 'D.E. / P.O.S.';
  if (v.includes('soporte')) return 'Documento soporte';
  if (v.includes('facturaci') && v.includes('papel')) return 'Facturación de papel';
  return valor;
}

// POST /resoluciones/parsear-pdf — Parse a DIAN Form 1876 PDF
router.post('/parsear-pdf', uploadPdf.single('pdf'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió ningún archivo PDF.' });
  }

  try {
    const buffer = fs.readFileSync(req.file.path);
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const data = await parser.getText();
    await parser.destroy();
    const texto = data.text || '';
    const lines = texto.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // DEBUG
    console.log('\n========== PDF TEXT START ==========');
    console.log(texto);
    console.log('========== PDF TEXT END ==========\n');

    // ============ DIAN FORM 1876 PARSER ============

    // 1. NIT + DV — spaced digits like "9 0 1 9 6 8 7 9 5 1"
    //    The LAST digit is the DV (dígito de verificación), the rest is the NIT
    let nit = '';
    let dv = '';
    const rawLines = texto.split(/\r?\n|\r/);
    for (const rawLine of rawLines) {
      const l = rawLine.trim();
      // Match lines of ONLY single digits separated by spaces (8-12 digits total)
      if (/^\d( \d){7,11}$/.test(l)) {
        const cleaned = l.replace(/\s+/g, '');
        if (cleaned.length >= 8 && cleaned.length <= 12) {
          nit = cleaned.slice(0, -1); // All except last digit
          dv = cleaned.slice(-1);     // Last digit is DV
          break;
        }
      }
    }

    // 2. DATE — "2025-09-08 / 06:29:51 PM" or spaced
    let fecha_resolucion = '';
    const dateMatch = texto.match(/(\d{4}-\d{2}-\d{2})\s*\/\s*\d{2}:\d{2}:\d{2}/);
    if (dateMatch) {
      fecha_resolucion = dateMatch[1];
    } else {
      const spacedDate = texto.match(/(\d\s+\d\s+\d\s+\d)\s*-\s*(\d\s+\d)\s*-\s*(\d\s+\d)/);
      if (spacedDate) {
        const y = spacedDate[1].replace(/\s+/g, '');
        const mo = spacedDate[2].replace(/\s+/g, '');
        const d = spacedDate[3].replace(/\s+/g, '');
        fecha_resolucion = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
    }

    // 3. DATA ROW — all fields concatenated on one line:
    //    "FACTURA ELECTRÓNICA DE VENTA 4 FV 1 200 AUTORIZACIÓN 1  24"
    let modalidad = '', prefijo = '', desde = '', hasta = '', solicitud = '', vigencia = '';
    let establecimiento = '';

    const dataPattern = /(FACTURA\s+ELECTR[ÓO]NICA\s+DE\s+VENTA|D\.?E\.?\s*\/?\s*P\.?O\.?S\.?|DOCUMENTO\s+SOPORTE|FACTURACI[ÓO]N\s+(?:DE\s+)?COMPUTADOR|FACTURACI[ÓO]N\s+DE\s+PAPEL|FACTURA\s+DE\s+TALONARIO(?:\s+O\s+DE\s+PAPEL)?)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(AUTORIZACI[ÓO]N|HABILITACI[ÓO]N|INHABILITACI[ÓO]N)\s+(\d+)\s+(\d+)/i;
    const dataMatch2 = texto.match(dataPattern);

    if (dataMatch2) {
      modalidad = mapearModalidad(dataMatch2[1].trim());
      prefijo = dataMatch2[3].trim();
      desde = dataMatch2[4].trim();
      hasta = dataMatch2[5].trim();
      solicitud = mapearSolicitud(dataMatch2[6].trim());
      vigencia = dataMatch2[8].trim();

      // 4. ESTABLECIMIENTO — line before the data row
      const dataLineIdx = lines.findIndex(l => dataPattern.test(l));
      if (dataLineIdx > 0) {
        const prevLine = lines[dataLineIdx - 1];
        if (prevLine && prevLine.length > 3 && !/^\d+$/.test(prevLine) && !prevLine.includes('Establecimiento')) {
          establecimiento = prevLine;
        }
      }
    }

    // 5. NÚMERO DE FORMULARIO — long digit string (12+ digits), e.g. "18764098346468"
    let numero_formulario = '';
    for (const line of lines) {
      if (/^\d{12,}$/.test(line)) {
        numero_formulario = line;
        break;
      }
    }

    console.log('Extracted:', { nit, fecha_resolucion, modalidad, prefijo, desde, hasta, solicitud, vigencia, establecimiento, numero_formulario });

    // Result object
    const resultado = {
      nit,
      establecimiento,
      modalidad,
      prefijo,
      desde,
      hasta,
      solicitud,
      vigencia,
      fecha_resolucion,
      numero_formulario,
      tercero: null,
      tercero_encontrado: false,
      direccion_registrada: false,
      texto_extraido: texto.substring(0, 500)
    };

    // Validate NIT against terceros table
    if (nit) {
      const tercero = await db.getAsync('SELECT * FROM terceros WHERE nit = ?', [nit]);
      if (tercero) {
        resultado.tercero_encontrado = true;
        resultado.tercero = {
          id: tercero.id,
          nit: tercero.nit,
          dv: tercero.dv || '',
          nombre: tercero.tipo_persona === 'Juridica'
            ? (tercero.razon_social || '')
            : [tercero.primer_nombre, tercero.segundo_nombre, tercero.primer_apellido, tercero.segundo_apellido].filter(Boolean).join(' ')
        };

        // Check if establecimiento/address exists for this tercero
        if (establecimiento) {
          const dirExiste = await db.getAsync(
            'SELECT * FROM direcciones_tercero WHERE tercero_nit = ? AND LOWER(direccion) = LOWER(?)',
            [nit, establecimiento]
          );
          if (!dirExiste) {
            // Auto-register the address
            await db.runAsync(
              'INSERT INTO direcciones_tercero (tercero_nit, direccion) VALUES (?, ?)',
              [nit, establecimiento]
            );
            resultado.direccion_registrada = true;
          }
        }
      }
    }

    res.json(resultado);
  } catch (e) {
    res.status(500).json({ error: 'Error al procesar el PDF: ' + e.message });
  } finally {
    // Clean up temp file
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, () => {});
    }
  }
});

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
