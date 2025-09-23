const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const db = new sqlite3.Database(path.join(__dirname, '..', 'siaf.db'));

// Función para generar código de mantenimiento
const generateMaintenanceCode = () => {
    const now = new Date();
    const year = now.getFullYear().toString().substr(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `MNT-${year}${month}${day}-${random}`;
};

// Obtener todos los mantenimientos con filtros
router.get('/', authenticateToken, (req, res) => {
    const { page = 1, limit = 10, status, type, asset_id, technician_id } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
        SELECT 
            m.*,
            a.name as asset_name,
            a.asset_code,
            t.full_name as technician_name
        FROM maintenances m
        LEFT JOIN assets a ON m.asset_id = a.id
        LEFT JOIN users t ON m.technician_id = t.id
        WHERE 1=1
    `;
    
    let params = [];
    
    if (status) {
        query += ` AND m.status = ?`;
        params.push(status);
    }
    
    if (type) {
        query += ` AND m.type = ?`;
        params.push(type);
    }
    
    if (asset_id) {
        query += ` AND m.asset_id = ?`;
        params.push(asset_id);
    }
    
    if (technician_id) {
        query += ` AND m.technician_id = ?`;
        params.push(technician_id);
    }
    
    query += ` ORDER BY m.scheduled_date DESC, m.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);
    
    db.all(query, params, (err, maintenances) => {
        if (err) {
            return res.status(500).json({ message: 'Error al obtener mantenimientos' });
        }
        
        // Obtener total para paginación
        let countQuery = `SELECT COUNT(*) as total FROM maintenances m WHERE 1=1`;
        let countParams = [];
        
        if (status) {
            countQuery += ` AND m.status = ?`;
            countParams.push(status);
        }
        
        if (type) {
            countQuery += ` AND m.type = ?`;
            countParams.push(type);
        }
        
        if (asset_id) {
            countQuery += ` AND m.asset_id = ?`;
            countParams.push(asset_id);
        }
        
        if (technician_id) {
            countQuery += ` AND m.technician_id = ?`;
            countParams.push(technician_id);
        }
        
        db.get(countQuery, countParams, (err, countResult) => {
            if (err) {
                return res.status(500).json({ message: 'Error al contar mantenimientos' });
            }
            
            res.json({
                maintenances,
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

// Obtener un mantenimiento específico
router.get('/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    
    const query = `
        SELECT 
            m.*,
            a.name as asset_name,
            a.asset_code,
            t.full_name as technician_name
        FROM maintenances m
        LEFT JOIN assets a ON m.asset_id = a.id
        LEFT JOIN users t ON m.technician_id = t.id
        WHERE m.id = ?
    `;
    
    db.get(query, [id], (err, maintenance) => {
        if (err) {
            return res.status(500).json({ message: 'Error al obtener mantenimiento' });
        }
        
        if (!maintenance) {
            return res.status(404).json({ message: 'Mantenimiento no encontrado' });
        }
        
        res.json({ maintenance });
    });
});

// Crear nuevo mantenimiento
router.post('/', authenticateToken, [
    body('asset_id').isInt().withMessage('Activo válido es requerido'),
    body('type').isIn(['preventive', 'corrective', 'predictive']).withMessage('Tipo de mantenimiento inválido'),
    body('title').notEmpty().withMessage('Título es requerido'),
    body('scheduled_date').isISO8601().withMessage('Fecha programada válida es requerida')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    
    const {
        asset_id, type, title, description, scheduled_date,
        technician_id, cost, supplier, notes
    } = req.body;
    
    const maintenance_code = generateMaintenanceCode();
    
    db.run(
        `INSERT INTO maintenances (
            maintenance_code, asset_id, type, title, description,
            scheduled_date, technician_id, cost, supplier, notes, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')`,
        [maintenance_code, asset_id, type, title, description, 
         scheduled_date, technician_id, cost, supplier, notes],
        function(err) {
            if (err) {
                return res.status(500).json({ message: 'Error al crear mantenimiento' });
            }
            
            res.status(201).json({
                message: 'Mantenimiento programado exitosamente',
                maintenance: {
                    id: this.lastID,
                    maintenance_code,
                    title,
                    type,
                    scheduled_date,
                    status: 'scheduled'
                }
            });
        }
    );
});

// Actualizar mantenimiento
router.put('/:id', authenticateToken, [
    body('title').notEmpty().withMessage('Título es requerido'),
    body('type').isIn(['preventive', 'corrective', 'predictive']).withMessage('Tipo de mantenimiento inválido')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    
    const { id } = req.params;
    const {
        type, title, description, scheduled_date, technician_id,
        cost, supplier, notes, status
    } = req.body;
    
    db.run(
        `UPDATE maintenances SET
            type = ?, title = ?, description = ?, scheduled_date = ?,
            technician_id = ?, cost = ?, supplier = ?, notes = ?,
            status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [type, title, description, scheduled_date, technician_id,
         cost, supplier, notes, status, id],
        function(err) {
            if (err) {
                return res.status(500).json({ message: 'Error al actualizar mantenimiento' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ message: 'Mantenimiento no encontrado' });
            }
            
            res.json({ message: 'Mantenimiento actualizado exitosamente' });
        }
    );
});

// Iniciar mantenimiento
router.put('/:id/start', authenticateToken, (req, res) => {
    const { id } = req.params;
    
    db.run(
        `UPDATE maintenances SET 
         status = 'in_progress', updated_at = CURRENT_TIMESTAMP 
         WHERE id = ? AND status = 'scheduled'`,
        [id],
        function(err) {
            if (err) {
                return res.status(500).json({ message: 'Error al iniciar mantenimiento' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ message: 'Mantenimiento no encontrado o ya iniciado' });
            }
            
            res.json({ message: 'Mantenimiento iniciado exitosamente' });
        }
    );
});

// Completar mantenimiento
router.put('/:id/complete', authenticateToken, [
    body('notes').optional().isString()
], (req, res) => {
    const { id } = req.params;
    const { notes, cost } = req.body;
    
    let query = `
        UPDATE maintenances SET 
        status = 'completed', completed_date = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `;
    let params = [];
    
    if (notes) {
        query += `, notes = ?`;
        params.push(notes);
    }
    
    if (cost) {
        query += `, cost = ?`;
        params.push(cost);
    }
    
    query += ` WHERE id = ? AND status IN ('scheduled', 'in_progress')`;
    params.push(id);
    
    db.run(query, params, function(err) {
        if (err) {
            return res.status(500).json({ message: 'Error al completar mantenimiento' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ message: 'Mantenimiento no encontrado o ya completado' });
        }
        
        res.json({ message: 'Mantenimiento completado exitosamente' });
    });
});

// Obtener mantenimientos próximos
router.get('/upcoming/list', authenticateToken, (req, res) => {
    const { days = 30 } = req.query;
    
    const query = `
        SELECT 
            m.*,
            a.name as asset_name,
            a.asset_code,
            t.full_name as technician_name
        FROM maintenances m
        LEFT JOIN assets a ON m.asset_id = a.id
        LEFT JOIN users t ON m.technician_id = t.id
        WHERE m.scheduled_date BETWEEN DATE('now') AND DATE('now', '+' || ? || ' days')
        AND m.status = 'scheduled'
        ORDER BY m.scheduled_date ASC
    `;
    
    db.all(query, [days], (err, upcomingMaintenances) => {
        if (err) {
            return res.status(500).json({ message: 'Error al obtener mantenimientos próximos' });
        }
        
        res.json({ upcomingMaintenances });
    });
});

// Obtener mantenimientos vencidos
router.get('/overdue/list', authenticateToken, (req, res) => {
    const query = `
        SELECT 
            m.*,
            a.name as asset_name,
            a.asset_code,
            t.full_name as technician_name
        FROM maintenances m
        LEFT JOIN assets a ON m.asset_id = a.id
        LEFT JOIN users t ON m.technician_id = t.id
        WHERE m.scheduled_date < DATE('now')
        AND m.status = 'scheduled'
        ORDER BY m.scheduled_date ASC
    `;
    
    db.all(query, (err, overdueMaintenances) => {
        if (err) {
            return res.status(500).json({ message: 'Error al obtener mantenimientos vencidos' });
        }
        
        res.json({ overdueMaintenances });
    });
});

// Obtener estadísticas de mantenimientos
router.get('/stats/overview', authenticateToken, (req, res) => {
    const queries = {
        total: `SELECT COUNT(*) as count FROM maintenances`,
        byStatus: `SELECT status, COUNT(*) as count FROM maintenances GROUP BY status`,
        byType: `SELECT type, COUNT(*) as count FROM maintenances GROUP BY type`,
        upcoming: `
            SELECT COUNT(*) as count FROM maintenances 
            WHERE scheduled_date BETWEEN DATE('now') AND DATE('now', '+30 days') 
            AND status = 'scheduled'
        `,
        overdue: `
            SELECT COUNT(*) as count FROM maintenances 
            WHERE scheduled_date < DATE('now') AND status = 'scheduled'
        `,
        totalCost: `
            SELECT SUM(cost) as total FROM maintenances 
            WHERE completed_date >= DATE('now', '-12 months') AND cost IS NOT NULL
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