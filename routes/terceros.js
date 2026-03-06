const express = require('express');
const router = express.Router();
const db = require('../db/database');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// Multer config: temp uploads
const upload = multer({ dest: path.join(__dirname, '..', 'tmp') });

// Helper: build display name from tercero row
function displayName(t) {
    if (t.tipo_persona === 'Juridica') return t.razon_social || '';
    return [t.primer_nombre, t.segundo_nombre, t.primer_apellido, t.segundo_apellido]
        .filter(Boolean).join(' ');
}

// API — search for autocomplete (JSON)
router.get('/api/buscar', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    try {
        const rows = await db.allAsync(
            `SELECT * FROM terceros
       WHERE LOWER(nit) LIKE LOWER(?) OR LOWER(primer_nombre) LIKE LOWER(?) OR LOWER(segundo_nombre) LIKE LOWER(?)
         OR LOWER(primer_apellido) LIKE LOWER(?) OR LOWER(segundo_apellido) LIKE LOWER(?) OR LOWER(razon_social) LIKE LOWER(?)
       ORDER BY nit LIMIT 15`,
            Array(6).fill(`%${q}%`)
        );
        res.json(rows.map(t => ({
            id: t.id,
            nit: t.nit,
            dv: t.dv,
            tipo_persona: t.tipo_persona,
            nombre: displayName(t)
        })));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// List all
router.get('/', async (req, res) => {
    const search = req.query.search || '';
    let query = `SELECT *, 
        COALESCE(primer_nombre,'') || ' ' || COALESCE(segundo_nombre,'') || ' ' || COALESCE(primer_apellido,'') || ' ' || COALESCE(segundo_apellido,'') AS nombre_completo 
        FROM terceros WHERE 1=1`;
    const params = [];
    if (search) {
        query += ` AND (
            nit LIKE ? COLLATE NOCASE 
            OR primer_nombre LIKE ? COLLATE NOCASE 
            OR segundo_nombre LIKE ? COLLATE NOCASE 
            OR primer_apellido LIKE ? COLLATE NOCASE 
            OR segundo_apellido LIKE ? COLLATE NOCASE 
            OR razon_social LIKE ? COLLATE NOCASE
            OR (COALESCE(primer_nombre,'') || ' ' || COALESCE(segundo_nombre,'') || ' ' || COALESCE(primer_apellido,'') || ' ' || COALESCE(segundo_apellido,'')) LIKE ? COLLATE NOCASE
        )`;
        params.push(...Array(7).fill(`%${search}%`));
    }
    query += ' ORDER BY created_at DESC';
    try {
        const terceros = await db.allAsync(query, params);
        // add computed display name
        terceros.forEach(t => { t.nombre_display = displayName(t); });
        const totalRow = await db.getAsync('SELECT COUNT(*) as cnt FROM terceros');
        res.render('terceros_list', {
            terceros,
            search,
            total: totalRow.cnt,
            message: req.session.message || null
        });
        req.session.message = null;
    } catch (e) {
        res.status(500).send('Error al cargar terceros: ' + e.message);
    }
});

// New form
router.get('/nuevo', (req, res) => {
    res.render('terceros_form', {
        tercero: null,
        action: '/terceros',
        method: 'POST',
        title: 'Nuevo Tercero'
    });
});

// Create
router.post('/', async (req, res) => {
    const { nit, dv, tipo_persona, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, razon_social } = req.body;
    try {
        await db.runAsync(
            `INSERT INTO terceros (nit, dv, tipo_persona, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, razon_social)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [nit, dv || '', tipo_persona,
                tipo_persona === 'Natural' ? (primer_nombre || '') : '',
                tipo_persona === 'Natural' ? (segundo_nombre || '') : '',
                tipo_persona === 'Natural' ? (primer_apellido || '') : '',
                tipo_persona === 'Natural' ? (segundo_apellido || '') : '',
                tipo_persona === 'Juridica' ? (razon_social || '') : '']
        );
        req.session.message = { type: 'success', text: 'Tercero registrado exitosamente.' };
    } catch (e) {
        if (e.message.includes('UNIQUE')) {
            req.session.message = { type: 'error', text: 'Ya existe un tercero con ese NIT.' };
        } else {
            req.session.message = { type: 'error', text: 'Error al registrar: ' + e.message };
        }
    }
    res.redirect('/terceros');
});

// Edit form
router.get('/:id/editar', async (req, res) => {
    try {
        const tercero = await db.getAsync('SELECT * FROM terceros WHERE id = ?', [req.params.id]);
        if (!tercero) return res.redirect('/terceros');
        res.render('terceros_form', {
            tercero,
            action: `/terceros/${req.params.id}?_method=PUT`,
            method: 'POST',
            title: 'Editar Tercero'
        });
    } catch (e) {
        res.redirect('/terceros');
    }
});

// Update
router.put('/:id', async (req, res) => {
    const { nit, dv, tipo_persona, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, razon_social } = req.body;
    try {
        await db.runAsync(
            `UPDATE terceros SET nit=?, dv=?, tipo_persona=?, primer_nombre=?, segundo_nombre=?,
       primer_apellido=?, segundo_apellido=?, razon_social=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
            [nit, dv || '', tipo_persona,
                tipo_persona === 'Natural' ? (primer_nombre || '') : '',
                tipo_persona === 'Natural' ? (segundo_nombre || '') : '',
                tipo_persona === 'Natural' ? (primer_apellido || '') : '',
                tipo_persona === 'Natural' ? (segundo_apellido || '') : '',
                tipo_persona === 'Juridica' ? (razon_social || '') : '',
                req.params.id]
        );
        req.session.message = { type: 'success', text: 'Tercero actualizado exitosamente.' };
    } catch (e) {
        if (e.message.includes('UNIQUE')) {
            req.session.message = { type: 'error', text: 'Ya existe un tercero con ese NIT.' };
        } else {
            req.session.message = { type: 'error', text: 'Error al actualizar: ' + e.message };
        }
    }
    res.redirect('/terceros');
});

// Delete
router.delete('/:id', async (req, res) => {
    try {
        await db.runAsync('DELETE FROM terceros WHERE id = ?', [req.params.id]);
        req.session.message = { type: 'success', text: 'Tercero eliminado.' };
    } catch (e) {
        req.session.message = { type: 'error', text: 'Error al eliminar: ' + e.message };
    }
    res.redirect('/terceros');
});

// Import from Excel
router.post('/importar', upload.single('archivo'), async (req, res) => {
    if (!req.file) {
        req.session.message = { type: 'error', text: 'No se seleccionó ningún archivo.' };
        return res.redirect('/terceros');
    }
    try {
        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

        let insertados = 0, omitidos = 0, errores = [];

        for (const row of rows) {
            // Normalize column names (case-insensitive)
            const r = {};
            Object.keys(row).forEach(k => { r[k.trim().toUpperCase()] = String(row[k]).trim(); });

            const nit = r['NIT'] || '';
            const dv = r['DV'] || '';
            const tipo = (r['TIPO_PERSONA'] || 'Natural');
            const tipoNorm = tipo.charAt(0).toUpperCase() + tipo.slice(1).toLowerCase();

            if (!nit) { errores.push('Fila sin NIT, omitida'); continue; }
            if (!['Natural', 'Juridica'].includes(tipoNorm)) {
                errores.push(`NIT ${nit}: tipo_persona inválido "${tipo}"`);
                continue;
            }

            try {
                await db.runAsync(
                    `INSERT INTO terceros (nit, dv, tipo_persona, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, razon_social)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        nit, dv, tipoNorm,
                        tipoNorm === 'Natural' ? (r['PRIMER_NOMBRE'] || '') : '',
                        tipoNorm === 'Natural' ? (r['SEGUNDO_NOMBRE'] || '') : '',
                        tipoNorm === 'Natural' ? (r['PRIMER_APELLIDO'] || '') : '',
                        tipoNorm === 'Natural' ? (r['SEGUNDO_APELLIDO'] || '') : '',
                        tipoNorm === 'Juridica' ? (r['RAZON_SOCIAL'] || '') : ''
                    ]
                );
                insertados++;
            } catch (e) {
                if (e.message.includes('UNIQUE')) {
                    omitidos++;
                } else {
                    errores.push(`NIT ${nit}: ${e.message}`);
                }
            }
        }

        // Clean up temp file
        fs.unlink(req.file.path, () => {});

        let msg = `Importación completada: ${insertados} insertado(s), ${omitidos} omitido(s) por duplicado.`;
        if (errores.length > 0) msg += ` Errores: ${errores.slice(0, 5).join('; ')}`;
        req.session.message = { type: insertados > 0 ? 'success' : 'error', text: msg };
    } catch (e) {
        fs.unlink(req.file.path, () => {});
        req.session.message = { type: 'error', text: 'Error al procesar el archivo: ' + e.message };
    }
    res.redirect('/terceros');
});

module.exports = router;
