const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const db = new sqlite3.Database(path.join(__dirname, '..', 'siaf.db'));

// Función para generar código de formato responsivo
const generateFormCode = () => {
    const now = new Date();
    const year = now.getFullYear().toString().substr(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `FR-${year}${month}${day}-${random}`;
};

// Obtener todos los formatos responsivos con filtros
router.get('/', authenticateToken, (req, res) => {
    const { page = 1, limit = 10, status, asset_id, new_responsible_id } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
        SELECT 
            rf.*,
            a.name as asset_name,
            a.asset_code,
            prev.full_name as previous_responsible_name,
            new.full_name as new_responsible_name,
            approver.full_name as approved_by_name
        FROM responsive_forms rf
        LEFT JOIN assets a ON rf.asset_id = a.id
        LEFT JOIN users prev ON rf.previous_responsible_id = prev.id
        LEFT JOIN users new ON rf.new_responsible_id = new.id
        LEFT JOIN users approver ON rf.approved_by = approver.id
        WHERE 1=1
    `;
    
    let params = [];
    
    if (status) {
        query += ` AND rf.status = ?`;
        params.push(status);
    }
    
    if (asset_id) {
        query += ` AND rf.asset_id = ?`;
        params.push(asset_id);
    }
    
    if (new_responsible_id) {
        query += ` AND rf.new_responsible_id = ?`;
        params.push(new_responsible_id);
    }
    
    query += ` ORDER BY rf.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);
    
    db.all(query, params, (err, forms) => {
        if (err) {
            return res.status(500).json({ message: 'Error al obtener formatos responsivos' });
        }
        
        // Obtener total para paginación
        let countQuery = `SELECT COUNT(*) as total FROM responsive_forms rf WHERE 1=1`;
        let countParams = [];
        
        if (status) {
            countQuery += ` AND rf.status = ?`;
            countParams.push(status);
        }
        
        if (asset_id) {
            countQuery += ` AND rf.asset_id = ?`;
            countParams.push(asset_id);
        }
        
        if (new_responsible_id) {
            countQuery += ` AND rf.new_responsible_id = ?`;
            countParams.push(new_responsible_id);
        }
        
        db.get(countQuery, countParams, (err, countResult) => {
            if (err) {
                return res.status(500).json({ message: 'Error al contar formatos responsivos' });
            }
            
            res.json({
                forms,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult.total,
                    totalPages: Math.ceil(countResult.total / limit)
                }
            });
        });
    });
});

// Obtener un formato responsivo específico
router.get('/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    
    const query = `
        SELECT 
            rf.*,
            a.name as asset_name,
            a.asset_code,
            a.brand,
            a.model,
            a.serial_number,
            prev.full_name as previous_responsible_name,
            prev.department as previous_department,
            new.full_name as new_responsible_name,
            new.department as new_department,
            approver.full_name as approved_by_name
        FROM responsive_forms rf
        LEFT JOIN assets a ON rf.asset_id = a.id
        LEFT JOIN users prev ON rf.previous_responsible_id = prev.id
        LEFT JOIN users new ON rf.new_responsible_id = new.id
        LEFT JOIN users approver ON rf.approved_by = approver.id
        WHERE rf.id = ?
    `;
    
    db.get(query, [id], (err, form) => {
        if (err) {
            return res.status(500).json({ message: 'Error al obtener formato responsivo' });
        }
        
        if (!form) {
            return res.status(404).json({ message: 'Formato responsivo no encontrado' });
        }
        
        res.json({ form });
    });
});

// Crear nuevo formato responsivo
router.post('/', authenticateToken, [
    body('asset_id').isInt().withMessage('Activo válido es requerido'),
    body('new_responsible_id').isInt().withMessage('Nuevo responsable válido es requerido'),
    body('transfer_date').isISO8601().withMessage('Fecha de transferencia válida es requerida'),
    body('reason').notEmpty().withMessage('Razón de la transferencia es requerida')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    
    const {
        asset_id, new_responsible_id, transfer_date, reason,
        conditions, observations
    } = req.body;
    
    const form_code = generateFormCode();
    
    // Obtener el responsable actual del activo
    db.get(`SELECT responsible_user_id FROM assets WHERE id = ?`, [asset_id], (err, asset) => {
        if (err) {
            return res.status(500).json({ message: 'Error al obtener información del activo' });
        }
        
        if (!asset) {
            return res.status(404).json({ message: 'Activo no encontrado' });
        }
        
        const previous_responsible_id = asset.responsible_user_id;
        
        db.run(
            `INSERT INTO responsive_forms (
                form_code, asset_id, previous_responsible_id, new_responsible_id,
                transfer_date, reason, conditions, observations, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [form_code, asset_id, previous_responsible_id, new_responsible_id,
             transfer_date, reason, conditions, observations],
            function(err) {
                if (err) {
                    return res.status(500).json({ message: 'Error al crear formato responsivo' });
                }
                
                res.status(201).json({
                    message: 'Formato responsivo creado exitosamente',
                    form: {
                        id: this.lastID,
                        form_code,
                        asset_id,
                        new_responsible_id,
                        transfer_date,
                        status: 'pending'
                    }
                });
            }
        );
    });
});

// Aprobar formato responsivo
router.put('/:id/approve', authenticateToken, [
    body('approved').isBoolean().withMessage('Estado de aprobación requerido')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    
    const { id } = req.params;
    const { approved, comments } = req.body;
    const approved_by = req.user.id;
    
    const status = approved ? 'approved' : 'rejected';
    
    db.serialize(() => {
        // Actualizar el formato responsivo
        db.run(
            `UPDATE responsive_forms SET 
             status = ?, approved_by = ?, observations = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE id = ? AND status = 'pending'`,
            [status, approved_by, comments, id],
            function(err) {
                if (err) {
                    return res.status(500).json({ message: 'Error al actualizar formato responsivo' });
                }
                
                if (this.changes === 0) {
                    return res.status(404).json({ message: 'Formato no encontrado o ya procesado' });
                }
                
                // Si fue aprobado, actualizar el responsable del activo
                if (approved) {
                    db.get(
                        `SELECT asset_id, new_responsible_id FROM responsive_forms WHERE id = ?`,
                        [id],
                        (err, form) => {
                            if (err || !form) {
                                return res.status(500).json({ message: 'Error al obtener datos del formato' });
                            }
                            
                            db.run(
                                `UPDATE assets SET 
                                 responsible_user_id = ?, updated_at = CURRENT_TIMESTAMP 
                                 WHERE id = ?`,
                                [form.new_responsible_id, form.asset_id],
                                (err) => {
                                    if (err) {
                                        return res.status(500).json({ message: 'Error al actualizar responsable del activo' });
                                    }
                                    
                                    res.json({ 
                                        message: `Formato responsivo ${status === 'approved' ? 'aprobado' : 'rechazado'} exitosamente` 
                                    });
                                }
                            );
                        }
                    );
                } else {
                    res.json({ 
                        message: `Formato responsivo ${status === 'approved' ? 'aprobado' : 'rechazado'} exitosamente` 
                    });
                }
            }
        );
    });
});

// Obtener historial de responsabilidades de un activo
router.get('/asset/:assetId/history', authenticateToken, (req, res) => {
    const { assetId } = req.params;
    
    const query = `
        SELECT 
            rf.*,
            prev.full_name as previous_responsible_name,
            prev.department as previous_department,
            new.full_name as new_responsible_name,
            new.department as new_department,
            approver.full_name as approved_by_name
        FROM responsive_forms rf
        LEFT JOIN users prev ON rf.previous_responsible_id = prev.id
        LEFT JOIN users new ON rf.new_responsible_id = new.id
        LEFT JOIN users approver ON rf.approved_by = approver.id
        WHERE rf.asset_id = ? AND rf.status = 'approved'
        ORDER BY rf.transfer_date DESC
    `;
    
    db.all(query, [assetId], (err, history) => {
        if (err) {
            return res.status(500).json({ message: 'Error al obtener historial de responsabilidades' });
        }
        
        res.json({ history });
    });
});

// Obtener formatos pendientes de aprobación
router.get('/pending/approval', authenticateToken, (req, res) => {
    const query = `
        SELECT 
            rf.*,
            a.name as asset_name,
            a.asset_code,
            prev.full_name as previous_responsible_name,
            new.full_name as new_responsible_name
        FROM responsive_forms rf
        LEFT JOIN assets a ON rf.asset_id = a.id
        LEFT JOIN users prev ON rf.previous_responsible_id = prev.id
        LEFT JOIN users new ON rf.new_responsible_id = new.id
        WHERE rf.status = 'pending'
        ORDER BY rf.created_at ASC
    `;
    
    db.all(query, (err, pendingForms) => {
        if (err) {
            return res.status(500).json({ message: 'Error al obtener formatos pendientes' });
        }
        
        res.json({ pendingForms });
    });
});

// Generar PDF del formato responsivo
router.get('/:id/pdf', authenticateToken, (req, res) => {
    const { id } = req.params;
    
    const query = `
        SELECT 
            rf.*,
            a.name as asset_name,
            a.asset_code,
            a.brand,
            a.model,
            a.serial_number,
            a.description,
            prev.full_name as previous_responsible_name,
            prev.department as previous_department,
            new.full_name as new_responsible_name,
            new.department as new_department,
            approver.full_name as approved_by_name
        FROM responsive_forms rf
        LEFT JOIN assets a ON rf.asset_id = a.id
        LEFT JOIN users prev ON rf.previous_responsible_id = prev.id
        LEFT JOIN users new ON rf.new_responsible_id = new.id
        LEFT JOIN users approver ON rf.approved_by = approver.id
        WHERE rf.id = ?
    `;
    
    db.get(query, [id], (err, form) => {
        if (err) {
            return res.status(500).json({ message: 'Error al obtener formato responsivo' });
        }
        
        if (!form) {
            return res.status(404).json({ message: 'Formato responsivo no encontrado' });
        }
        
        // Aquí se generaría el PDF con los datos del formato
        // Por ahora retornamos los datos para generar el PDF en el frontend
        res.json({ 
            form,
            pdfData: {
                title: `Formato Responsivo ${form.form_code}`,
                hotel: 'Beachscape Kin Ha Villas & Suites',
                address: 'Blvd. Kukulcán Km 8.5, Zona Hotelera, Cancún, Quintana Roo',
                date: new Date().toLocaleDateString('es-MX')
            }
        });
    });
});

// Obtener estadísticas de formatos responsivos
router.get('/stats/overview', authenticateToken, (req, res) => {
    const queries = {
        total: `SELECT COUNT(*) as count FROM responsive_forms`,
        byStatus: `SELECT status, COUNT(*) as count FROM responsive_forms GROUP BY status`,
        pending: `SELECT COUNT(*) as count FROM responsive_forms WHERE status = 'pending'`,
        approved: `SELECT COUNT(*) as count FROM responsive_forms WHERE status = 'approved'`,
        rejected: `SELECT COUNT(*) as count FROM responsive_forms WHERE status = 'rejected'`,
        thisMonth: `
            SELECT COUNT(*) as count FROM responsive_forms 
            WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
        `
    };
    
    const stats = {};
    const promises = [];
    
    Object.keys(queries).forEach(key => {
        promises.push(new Promise((resolve, reject) => {
            db.all(queries[key], (err, result) => {
                if (err) reject(err);
                else {
                    stats[key] = result;
                    resolve();
                }
            });
        }));
    });
    
    Promise.all(promises)
        .then(() => {
            res.json({ stats });
        })
        .catch(err => {
            res.status(500).json({ message: 'Error al obtener estadísticas' });
        });
});

module.exports = router;