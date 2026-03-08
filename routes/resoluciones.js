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
  if (/^papel$/i.test(v.trim())) return 'Factura de talonario o de papel';
  return valor;
}

// Shared function: extract all form fields from PDF text
function extraerDatosFormulario(texto) {
  const rawLines = texto.split(/\r?\n|\r/);
  const lines = rawLines.map(l => l.trim()).filter(l => l.length > 0);

  // 1. NIT + DV
  let nit = '', dv = '';
  for (const rawLine of rawLines) {
    const l = rawLine.trim();
    if (/^\d( \d){7,11}$/.test(l)) {
      const cleaned = l.replace(/\s+/g, '');
      if (cleaned.length >= 8 && cleaned.length <= 12) {
        nit = cleaned.slice(0, -1);
        dv = cleaned.slice(-1);
        break;
      }
    }
  }

  // 2. DATE
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

  // 3. DATA ROW — try multiple regex patterns
  let modalidad = '', prefijo = '', desde = '', hasta = '', solicitud = '', vigencia = '';
  let establecimiento = '';

  // Pattern A: full modalidad name WITH prefijo on one line (vigencia optional)
  const patternA = /(FACTURA\s+ELECTR[ÓO]NICA\s+DE\s+VENTA|D\.?E\.?\s*\/?\s*P\.?O\.?S\.?|DOCUMENTO\s+SOPORTE|FACTURACI[ÓO]N\s+(?:DE\s+)?COMPUTADOR|FACTURACI[ÓO]N\s+DE\s+PAPEL|FACTURA\s+DE\s+TALONARIO(?:\s+O\s+DE\s+PAPEL)?)\s+(\d+)\s+(\S+)\s+([\d,.]+)\s+([\d,.]+)\s+(AUTORIZACI[ÓO]N|HABILITACI[ÓO]N|INHABILITACI[ÓO]N)\s+(\d+)(?:[\s\t]+(\d+))?/i;

  // Pattern B: truncated modalidad WITH prefijo on one line (vigencia optional)
  const patternB = /(PAPEL|COMPUTADOR|SOPORTE|ELECTR[ÓO]NICA|TALONARIO)\s+(\d+)\s+(\S+)\s+([\d,.]+)\s+([\d,.]+)\s+(AUTORIZACI[ÓO]N|HABILITACI[ÓO]N|INHABILITACI[ÓO]N)\s+(\d+)(?:[\s\t]+(\d+))?/i;

  // Pattern A2: full modalidad WITHOUT prefijo (vigencia optional)
  const patternA2 = /(FACTURA\s+ELECTR[ÓO]NICA\s+DE\s+VENTA|D\.?E\.?\s*\/?\s*P\.?O\.?S\.?|DOCUMENTO\s+SOPORTE|FACTURACI[ÓO]N\s+(?:DE\s+)?COMPUTADOR|FACTURACI[ÓO]N\s+DE\s+PAPEL|FACTURA\s+DE\s+TALONARIO(?:\s+O\s+DE\s+PAPEL)?)\s+(\d+)\s+([\d,.]+)\s+([\d,.]+)\s+(AUTORIZACI[ÓO]N|HABILITACI[ÓO]N|INHABILITACI[ÓO]N)\s+(\d+)(?:[\s\t]+(\d+))?/i;

  // Pattern B2: truncated modalidad WITHOUT prefijo (vigencia optional)
  const patternB2 = /(PAPEL|COMPUTADOR|SOPORTE|ELECTR[ÓO]NICA|TALONARIO)\s+(\d+)\s+([\d,.]+)\s+([\d,.]+)\s+(AUTORIZACI[ÓO]N|HABILITACI[ÓO]N|INHABILITACI[ÓO]N)\s+(\d+)(?:[\s\t]+(\d+))?/i;

  let dataMatch = texto.match(patternA);
  let hasPrefijo = true;
  if (!dataMatch) { dataMatch = texto.match(patternB); }
  if (!dataMatch) { dataMatch = texto.match(patternA2); hasPrefijo = false; }
  if (!dataMatch) { dataMatch = texto.match(patternB2); hasPrefijo = false; }

  if (dataMatch) {
    modalidad = mapearModalidad(dataMatch[1].trim());
    if (hasPrefijo) {
      // Groups: 1=modalidad, 2=cod, 3=prefijo, 4=desde, 5=hasta, 6=solicitud, 7=cod2, 8=vigencia(optional)
      prefijo = dataMatch[3].trim();
      desde = dataMatch[4].trim().replace(/,/g, '');
      hasta = dataMatch[5].trim().replace(/,/g, '');
      solicitud = mapearSolicitud(dataMatch[6].trim());
      vigencia = (dataMatch[8] || '').trim();
    } else {
      // Groups: 1=modalidad, 2=cod, 3=desde, 4=hasta, 5=solicitud, 6=cod2, 7=vigencia(optional)
      desde = dataMatch[3].trim().replace(/,/g, '');
      hasta = dataMatch[4].trim().replace(/,/g, '');
      solicitud = mapearSolicitud(dataMatch[5].trim());
      vigencia = (dataMatch[7] || '').trim();
    }

    // ESTABLECIMIENTO — line before the data row
    const matchedPattern = texto.match(patternA) ? patternA : texto.match(patternB) ? patternB : texto.match(patternA2) ? patternA2 : patternB2;
    const dataLineIdx = lines.findIndex(l => matchedPattern.test(l));
    if (dataLineIdx > 0) {
      const prevLine = lines[dataLineIdx - 1];
      if (prevLine && prevLine.length > 3 && !/^\d+$/.test(prevLine) && !prevLine.includes('Establecimiento')) {
        establecimiento = prevLine;
      }
    }
  } else {
    // Pattern C: data split across multiple lines (e.g. "FACTURA ELECTRÓNICA DE VENTA 4", then "FE", "2,251", "10,000", "AUTORIZACIÓN 1", "12")
    // Find modalidad line
    const modalidadPatterns = [
      /^(FACTURA\s+ELECTR[ÓO]NICA\s+DE\s+VENTA)\s+\d+$/i,
      /^(DOCUMENTO\s+SOPORTE)\s+\d+$/i,
      /^(FACTURACI[ÓO]N\s+(?:DE\s+)?COMPUTADOR)\s+\d+$/i,
      /^(FACTURACI[ÓO]N\s+DE\s+PAPEL)\s+\d+$/i,
      /^(FACTURA\s+DE\s+TALONARIO(?:\s+O\s+DE\s+PAPEL)?)\s+\d+$/i,
      /^(D\.?E\.?\s*\/?\s*P\.?O\.?S\.?)\s+\d+$/i,
      /^(PAPEL)\s+\d+$/i,
      /^(COMPUTADOR)\s+\d+$/i,
      /^(SOPORTE)\s+\d+$/i
    ];

    let modIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      for (const mp of modalidadPatterns) {
        const m = lines[i].match(mp);
        if (m) {
          modalidad = mapearModalidad(m[1].trim());
          modIdx = i;
          break;
        }
      }
      if (modIdx >= 0) break;
    }

    if (modIdx >= 0) {
      // Collect remaining data lines after the modalidad line
      // Look for: prefijo, desde, hasta, solicitud+cod, vigencia in subsequent lines
      const afterLines = lines.slice(modIdx + 1);
      const solicitudMatch = afterLines.findIndex(l => /AUTORIZACI[ÓO]N|HABILITACI[ÓO]N|INHABILITACI[ÓO]N/i.test(l));

      if (solicitudMatch >= 0) {
        // Lines before solicitud are: prefijo, desde, hasta
        const dataBeforeSolicitud = afterLines.slice(0, solicitudMatch);
        // Lines after solicitud: vigencia
        const solLine = afterLines[solicitudMatch];
        const solMatch = solLine.match(/(AUTORIZACI[ÓO]N|HABILITACI[ÓO]N|INHABILITACI[ÓO]N)\s*(\d*)/i);
        if (solMatch) solicitud = mapearSolicitud(solMatch[1].trim());

        // Vigencia is typically next numeric line after solicitud
        for (let v = solicitudMatch + 1; v < afterLines.length && v <= solicitudMatch + 3; v++) {
          if (/^\d+$/.test(afterLines[v])) {
            vigencia = afterLines[v];
            break;
          }
        }

        // Parse prefijo/desde/hasta from data lines before solicitud
        // Filter only meaningful data (not repeated modalidad lines, not "-- X of Y --")
        const numericOrAlpha = dataBeforeSolicitud.filter(l => 
          !modalidadPatterns.some(mp => mp.test(l)) && 
          !/^--/.test(l) && 
          !/^\d{12,}$/.test(l) &&
          !/^\d\s+\d/.test(l) &&
          l.length < 50
        );

        if (numericOrAlpha.length >= 3) {
          prefijo = numericOrAlpha[0];
          desde = numericOrAlpha[1].replace(/,/g, '');
          hasta = numericOrAlpha[2].replace(/,/g, '');
        } else if (numericOrAlpha.length === 2) {
          desde = numericOrAlpha[0].replace(/,/g, '');
          hasta = numericOrAlpha[1].replace(/,/g, '');
        }
      }

      // ESTABLECIMIENTO — line before the modalidad line
      if (modIdx > 0) {
        const prevLine = lines[modIdx - 1];
        if (prevLine && prevLine.length > 3 && !/^\d+$/.test(prevLine) && !prevLine.includes('Establecimiento') && !/^\d\s+\d/.test(prevLine)) {
          establecimiento = prevLine;
        }
      }
    }
  }

  // 4. NÚMERO DE FORMULARIO — long digit string (12+ digits)
  // Some older PDFs concatenate the form type "1876" with the actual number, e.g. "187618762003231498"
  let numero_formulario = '';
  for (const line of lines) {
    if (/^\d{12,}$/.test(line)) {
      let num = line;
      // Strip leading "1876" prefix if duplicated (e.g. "187618762003231498" → "18762003231498")
      if (num.startsWith('1876') && num.length > 14 && num.substring(4).startsWith('1876')) {
        num = num.substring(4);
      }
      numero_formulario = num;
      break;
    }
  }

  return { nit, dv, fecha_resolucion, modalidad, prefijo, desde, hasta, solicitud, vigencia, establecimiento, numero_formulario };
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

    // DEBUG
    console.log('\n========== PDF TEXT START ==========');
    console.log(texto);
    console.log('========== PDF TEXT END ==========\n');

    // Extract all fields using the shared parser
    const { nit, dv, fecha_resolucion, modalidad, prefijo, desde, hasta, solicitud, vigencia, establecimiento, numero_formulario } = extraerDatosFormulario(texto);

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
      resolucion_existe: false,
      pdf_temp: req.file ? path.basename(req.file.path) : '',
      texto_extraido: texto.substring(0, 500)
    };

    // Check if resolution number already exists
    if (numero_formulario) {
      const resExiste = await db.getAsync('SELECT * FROM resoluciones WHERE numero_resolucion = ?', [numero_formulario]);
      if (resExiste) {
        resultado.resolucion_existe = true;
        resultado.resolucion_datos = resExiste;
        // Check if PDF file already exists
        const pdfNombre = `${resExiste.fecha_resolucion}-${resExiste.numero_resolucion}`;
        const pdfPath = path.join(__dirname, '..', 'uploads', 'pdfs', pdfNombre + '.pdf');
        resultado.pdf_nombre = pdfNombre;
        resultado.pdf_existe = fs.existsSync(pdfPath);
      }
    }

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
    // Clean up temp file only on error
    if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
  }
  // Note: temp file is kept for deferred save on registration
});

// POST /resoluciones/validar-pdfs — Validate multiple PDFs at once (full extraction)
router.post('/validar-pdfs', uploadPdf.array('pdfs', 50), async (req, res) => {
  const resultados = [];
  try {
    for (const file of (req.files || [])) {
      try {
        const buffer = fs.readFileSync(file.path);
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        const pdfData = await parser.getText();
        await parser.destroy();
        const texto = pdfData.text || '';

        // Extract all fields using the shared parser
        const extracted = extraerDatosFormulario(texto);
        const { nit, dv, fecha_resolucion, modalidad, prefijo, desde, hasta, solicitud, vigencia, establecimiento, numero_formulario: numFormulario } = extracted;

        // Lookup tercero for nombre
        let nombre_tercero = '';
        if (nit) {
          const tercero = await db.getAsync('SELECT * FROM terceros WHERE nit = ?', [nit]);
          if (tercero) {
            nombre_tercero = tercero.tipo_persona === 'Juridica'
              ? (tercero.razon_social || '')
              : [tercero.primer_nombre, tercero.segundo_nombre, tercero.primer_apellido, tercero.segundo_apellido].filter(Boolean).join(' ');
          }
        }

        // Check DB
        let existe = false, pdfExiste = false, pdfNombre = '';
        if (numFormulario) {
          const row = await db.getAsync('SELECT * FROM resoluciones WHERE numero_resolucion = ?', [numFormulario]);
          if (row) {
            existe = true;
            pdfNombre = `${row.fecha_resolucion}-${row.numero_resolucion}`;
            const pdfPath = path.join(__dirname, '..', 'uploads', 'pdfs', pdfNombre + '.pdf');
            pdfExiste = fs.existsSync(pdfPath);
          }
        }

        resultados.push({
          archivo: file.originalname,
          temp: path.basename(file.path),
          numero_formulario: numFormulario || 'No detectado',
          nit: nit + (dv ? '-' + dv : ''),
          nombre_tercero,
          fecha_resolucion,
          modalidad,
          solicitud,
          prefijo,
          desde,
          hasta,
          vigencia,
          establecimiento,
          resolucion_existe: existe,
          pdf_existe: pdfExiste,
          pdf_nombre: pdfNombre
        });
      } catch (parseErr) {
        resultados.push({
          archivo: file.originalname,
          temp: path.basename(file.path),
          numero_formulario: 'Error',
          resolucion_existe: false,
          pdf_existe: false,
          pdf_nombre: '',
          error: parseErr.message
        });
      }
    }
    res.json({ ok: true, resultados });
  } catch (e) {
    res.status(500).json({ error: 'Error al procesar PDFs: ' + e.message });
  }
});

// POST /resoluciones/guardar-resolucion-pdf — Create resolution + save PDF from multi-upload
router.post('/guardar-resolucion-pdf', async (req, res) => {
  const { pdf_temp, nit, nombre_tercero, fecha_resolucion, numero_resolucion, modalidad, solicitud, prefijo, desde, hasta, vigencia, establecimiento } = req.body;
  if (!numero_resolucion || !pdf_temp) {
    return res.status(400).json({ error: 'Faltan datos requeridos.' });
  }
  try {
    // Check duplicate
    const existe = await db.getAsync('SELECT id FROM resoluciones WHERE numero_resolucion = ?', [numero_resolucion]);
    if (existe) {
      return res.status(409).json({ error: `Ya existe una resolución con el número ${numero_resolucion}.` });
    }

    // Insert resolution
    await db.runAsync(
      `INSERT INTO resoluciones (nit, nombre_tercero, fecha_resolucion, numero_resolucion, modalidad, solicitud, prefijo, sucursal, desde, hasta, vigencia)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nit || '', nombre_tercero || '', fecha_resolucion || '', numero_resolucion, modalidad || '', solicitud || '', prefijo || '', establecimiento || '', desde || '', hasta || '', vigencia || '']
    );

    // Save PDF
    const tmpPath = path.join(__dirname, '..', 'tmp', pdf_temp);
    if (fs.existsSync(tmpPath)) {
      const pdfsDir = path.join(__dirname, '..', 'uploads', 'pdfs');
      if (!fs.existsSync(pdfsDir)) fs.mkdirSync(pdfsDir, { recursive: true });
      const destName = `${fecha_resolucion || 'sin-fecha'}-${numero_resolucion}.pdf`;
      fs.copyFileSync(tmpPath, path.join(pdfsDir, destName));
      fs.unlink(tmpPath, () => {});
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al guardar: ' + e.message });
  }
});

// Save PDF from temp file using resolution number (for multi-upload)
router.post('/subir-pdf-temp', async (req, res) => {
  const { pdf_temp, numero_resolucion } = req.body;
  if (!pdf_temp || !numero_resolucion) {
    return res.status(400).json({ error: 'Faltan datos.' });
  }
  try {
    const resolucion = await db.getAsync('SELECT fecha_resolucion, numero_resolucion FROM resoluciones WHERE numero_resolucion = ?', [numero_resolucion]);
    if (!resolucion) {
      return res.status(404).json({ error: 'Resolución no encontrada.' });
    }
    const tmpPath = path.join(__dirname, '..', 'tmp', pdf_temp);
    if (!fs.existsSync(tmpPath)) {
      return res.status(404).json({ error: 'El archivo temporal ya no existe.' });
    }
    const pdfsDir = path.join(__dirname, '..', 'uploads', 'pdfs');
    if (!fs.existsSync(pdfsDir)) fs.mkdirSync(pdfsDir, { recursive: true });
    const destName = `${resolucion.fecha_resolucion}-${resolucion.numero_resolucion}.pdf`;
    fs.copyFileSync(tmpPath, path.join(pdfsDir, destName));
    fs.unlink(tmpPath, () => {});
    res.json({ ok: true, nombre: destName });
  } catch (e) {
    res.status(500).json({ error: 'Error: ' + e.message });
  }
});

// Save PDF only (for existing resolutions that don't have a PDF)
router.post('/guardar-pdf', async (req, res) => {
  const { pdf_temp, fecha_resolucion, numero_resolucion } = req.body;
  if (!pdf_temp || !fecha_resolucion || !numero_resolucion) {
    return res.status(400).json({ error: 'Faltan datos para guardar el PDF.' });
  }
  try {
    const tmpPath = path.join(__dirname, '..', 'tmp', pdf_temp);
    if (!fs.existsSync(tmpPath)) {
      return res.status(404).json({ error: 'El archivo temporal ya no existe. Por favor cargue el PDF de nuevo.' });
    }
    const pdfsDir = path.join(__dirname, '..', 'uploads', 'pdfs');
    if (!fs.existsSync(pdfsDir)) fs.mkdirSync(pdfsDir, { recursive: true });
    const destName = `${fecha_resolucion}-${numero_resolucion}.pdf`;
    const destPath = path.join(pdfsDir, destName);
    fs.copyFileSync(tmpPath, destPath);
    fs.unlink(tmpPath, () => {});
    res.json({ ok: true, nombre: destName });
  } catch (e) {
    res.status(500).json({ error: 'Error al guardar el PDF: ' + e.message });
  }
});

// Upload PDF for an existing resolution from the listing
router.post('/subir-pdf/:id', uploadPdf.single('pdf'), async (req, res) => {
  try {
    const resolucion = await db.getAsync('SELECT fecha_resolucion, numero_resolucion FROM resoluciones WHERE id = ?', [req.params.id]);
    if (!resolucion) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Resolución no encontrada.' });
    }

    // Parse PDF to validate formulario number (same pattern as parsear-pdf)
    const buffer = fs.readFileSync(req.file.path);
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const pdfData = await parser.getText();
    await parser.destroy();
    const texto = pdfData.text || '';

    // Extract numero_formulario (12+ digit number on its own line)
    let numFormulario = '';
    const rawLines = texto.split(/\r?\n|\r/);
    for (const rawLine of rawLines) {
      const l = rawLine.trim();
      if (/^\d{12,}$/.test(l)) { numFormulario = l; break; }
    }

    // Validate match
    if (!numFormulario) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'No se pudo extraer el número de formulario del PDF.' });
    }
    if (numFormulario !== resolucion.numero_resolucion) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: `El PDF corresponde a la resolución ${numFormulario}, pero esta resolución es ${resolucion.numero_resolucion}.` });
    }

    // Save PDF
    const pdfsDir = path.join(__dirname, '..', 'uploads', 'pdfs');
    if (!fs.existsSync(pdfsDir)) fs.mkdirSync(pdfsDir, { recursive: true });
    const destName = `${resolucion.fecha_resolucion}-${resolucion.numero_resolucion}.pdf`;
    const destPath = path.join(pdfsDir, destName);
    fs.copyFileSync(req.file.path, destPath);
    fs.unlink(req.file.path, () => {});
    res.json({ ok: true, nombre: destName });
  } catch (e) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: 'Error al subir el PDF: ' + e.message });
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
    // Check PDF existence for each resolution
    const pdfsDir = path.join(__dirname, '..', 'uploads', 'pdfs');
    resoluciones.forEach(r => {
      const pdfPath = path.join(pdfsDir, `${r.fecha_resolucion}-${r.numero_resolucion}.pdf`);
      r.has_pdf = fs.existsSync(pdfPath);
    });
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
  const message = req.session.message || null;
  req.session.message = null;
  // Clean up any leftover temp files
  const tmpDir = path.join(__dirname, '..', 'tmp');
  if (fs.existsSync(tmpDir)) {
    fs.readdir(tmpDir, (err, files) => {
      if (!err) files.forEach(f => fs.unlink(path.join(tmpDir, f), () => {}));
    });
  }
  res.render('form', { resolucion: null, action: '/resoluciones', method: 'POST', title: 'Nueva Resolución', message });
});

// Create
router.post('/', async (req, res) => {
  const { nit, nombre_tercero, fecha_resolucion, numero_resolucion, modalidad, solicitud, prefijo, sucursal, desde, hasta, vigencia, pdf_temp, guardar_pdf } = req.body;
  try {
    // Check for duplicate resolution number
    const existe = await db.getAsync('SELECT id FROM resoluciones WHERE numero_resolucion = ?', [numero_resolucion]);
    if (existe) {
      req.session.message = { type: 'error', text: `Ya existe una resolución con el número ${numero_resolucion}.` };
      return res.redirect('/resoluciones/nueva');
    }
    await db.runAsync(
      `INSERT INTO resoluciones (nit, nombre_tercero, fecha_resolucion, numero_resolucion, modalidad, solicitud, prefijo, sucursal, desde, hasta, vigencia)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nit, nombre_tercero, fecha_resolucion, numero_resolucion, modalidad, solicitud, prefijo || '', sucursal || '', desde, hasta, vigencia]
    );

    // Save PDF permanently only if checkbox was checked
    if (pdf_temp && guardar_pdf === '1') {
      try {
        const tmpPath = path.join(__dirname, '..', 'tmp', pdf_temp);
        const pdfsDir = path.join(__dirname, '..', 'uploads', 'pdfs');
        if (!fs.existsSync(pdfsDir)) fs.mkdirSync(pdfsDir, { recursive: true });
        const destName = `${fecha_resolucion}-${numero_resolucion}.pdf`;
        const destPath = path.join(pdfsDir, destName);
        if (fs.existsSync(tmpPath)) {
          fs.copyFileSync(tmpPath, destPath);
          fs.unlink(tmpPath, () => {});
        }
      } catch (pdfErr) {
        console.error('Error al guardar PDF:', pdfErr.message);
      }
    }

    req.session.message = { type: 'success', text: 'Resolución registrada exitosamente.' };
    res.redirect('/resoluciones/nueva');
  } catch (e) {
    req.session.message = { type: 'error', text: 'Error al registrar: ' + e.message };
    res.redirect('/resoluciones/nueva');
  }
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
      title: 'Editar Resolución',
      message: null
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

// Toggle checked state
router.patch('/:id/toggle-check', async (req, res) => {
  try {
    const row = await db.getAsync('SELECT checked FROM resoluciones WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'No encontrada.' });
    const newVal = row.checked ? 0 : 1;
    await db.runAsync('UPDATE resoluciones SET checked = ? WHERE id = ?', [newVal, req.params.id]);
    res.json({ ok: true, checked: newVal });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete
router.delete('/:id', async (req, res) => {
  try {
    // Get resolution data to find the PDF file
    const resolucion = await db.getAsync('SELECT fecha_resolucion, numero_resolucion FROM resoluciones WHERE id = ?', [req.params.id]);
    await db.runAsync('DELETE FROM resoluciones WHERE id = ?', [req.params.id]);
    // Delete associated PDF file
    if (resolucion) {
      const pdfPath = path.join(__dirname, '..', 'uploads', 'pdfs', `${resolucion.fecha_resolucion}-${resolucion.numero_resolucion}.pdf`);
      if (fs.existsSync(pdfPath)) fs.unlink(pdfPath, () => {});
    }
    req.session.message = { type: 'success', text: 'Resolución eliminada.' };
  } catch (e) {
    req.session.message = { type: 'error', text: 'Error al eliminar: ' + e.message };
  }
  res.redirect('/resoluciones');
});

module.exports = router;
