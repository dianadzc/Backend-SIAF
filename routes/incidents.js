const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const db = new sqlite3.Database(path.join(__dirname, '..', 'siaf.db'));

// Función para generar código de incidencia
const generateIncidentCode = () => {
    const now = new Date();
    const year = now.getFullYear().toString().substr(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `INC-${year}${month}${day}-${random}`;
};

// Obtener todas las incidencias con filtros
router.get('/', authenticateToken, (req, res) => {
    const { page = 1, limit = 10, status, priority, asset_id, assigned_to } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
        SELECT 
            i.*,
            a.name as asset_name,
            a.asset_code,
            reporter.full_name as reported_by_name,
            assignee.full_name as assigned_to_name
        FROM incidents i
        LEFT JOIN assets a ON i.asset_id = a.id
        LEFT JOIN users reporter ON i.reported_by = reporter.id
        LEFT JOIN users assignee ON i.assigned_to = assignee.id
        WHERE 1=1
    `;
    
    let params = [];
    
    if (status) {
        query += ` AND i.status = ?`;
        params.push(status);
    }
    
    if (priority) {
        query += ` AND i.priority = ?`;
        params.push(priority);
    }
    
    if (asset_id) {
        query += ` AND i.asset_id = ?`;
        params.push(asset_id);
    }
    
    if (assigned_to) {
        query += ` AND i.assigned_to = ?`;
        params.push(assigned_to);
    }
    
    query += ` ORDER BY i.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);
    
    db.all(query, params, (err, incidents) => {
        if (err) {
            return res.status(500).json({ message: 'Error al obtener incidencias' });
        }
        
        // Obtener total para paginación
        let countQuery = `SELECT COUNT(*) as total FROM incidents i WHERE 1=1`;
        let countParams = [];
        
        if (status) {
            countQuery += ` AND i.status = ?`;
            countParams.push(status);
        }
        
        if (priority) {
            countQuery += ` AND i.priority = ?`;
            countParams.push(priority);
        }
        
        if (asset_id) {
            countQuery += ` AND i.asset_id = ?`;
            countParams.push(asset_id);
        }
        
        if (assigned_to) {
            countQuery += ` AND i.assigned_to = ?`;
            countParams.push(assigned_to);
        }
        
        db.get(countQuery, countParams, (err, countResult) => {
            if (err) {
                return res.status(500).json({ message: 'Error al contar incidencias' });
            }
            
            res.json({
                incidents,
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

// Obtener una incidencia específica
router.get('/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    
    const query = `
        SELECT 
            i.*,
            a.name as asset_name,
            a.asset_code,
            reporter.full_name as reported_by_name,
            assignee.full_name as assigned_to_name
        FROM incidents i
        LEFT JOIN assets a ON i.asset_id = a.id
        LEFT JOIN users reporter ON i.reported_by = reporter.id
        LEFT JOIN users assignee ON i.assigned_to = assignee.id
        WHERE i.id = ?
    `;
    
    db.get(query, [id], (err, incident) => {
        if (err) {
            return res.status(500).json({ message: 'Error al obtener incidencia' });
        }
        
        if (!incident) {
            return res.status(404).json({ message: 'Incidencia no encontrada' });
        }
        
        res.json({ incident });
    });
});

// Crear nueva incidencia
router.post('/', authenticateToken, [
    body('title').notEmpty().withMessage('Título es requerido'),
    body('description').notEmpty().withMessage('Descripción es requerida'),
    body('priority').isIn(['low', 'medium', 'high', 'critical']).withMessage('Prioridad inválida')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    
    const {
        title, description, asset_id, priority = 'medium',
        assigned_to
    } = req.body;
    
    const incident_code = generateIncidentCode();
    const reported_by = req.user.id;
    
    db.run(
        `INSERT INTO incidents (
            incident_code, title, description, asset_id, priority,
            reported_by, assigned_to, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
        [incident_code, title, description, asset_id, priority, reported_by, assigned_to],
        function(err) {
            if (err) {
                return res.status(500).json({ message: 'Error al crear incidencia' });
            }
            
            res.status(201).json({
                message: 'Incidencia creada exitosamente',
                incident: {
                    id: this.lastID,
                    incident_code,
                    title,
                    priority,
                    status: 'open'
                }
            });
        }
    );
});

// Actualizar incidencia
router.put('/:id', authenticateToken, [
    body('title').notEmpty().withMessage('Título es requerido'),
    body('description').notEmpty().withMessage('Descripción es requerida')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    
    const { id } = req.params;
    const {
        title, description, priority, status, assigned_to, solution
    } = req.body;
    
    let query = `
        UPDATE incidents SET
            title = ?, description = ?, priority = ?, status = ?,
            assigned_to = ?, solution = ?, updated_at = CURRENT_TIMESTAMP
    `;
    
    let params = [title, description, priority, status, assigned_to, solution];
    
    // Si se está resolviendo la incidencia, agregar fecha de resolución
    if (status === 'resolved' || status === 'closed') {
        query += `, resolved_date = CURRENT_TIMESTAMP`;
    }
    
    query += ` WHERE id = ?`;
    params.push(id);
    
    db.run(query, params, function(err) {
        if (err) {
            return res.status(500).json({ message: 'Error al actualizar incidencia' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ message: 'Incidencia no encontrada' });
        }
        
        res.json({ message: 'Incidencia actualizada exitosamente' });
    });
});

// Asignar incidencia
router.put('/:id/assign', authenticateToken, [
    body('assigned_to').isInt().withMessage('Usuario asignado requerido')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    
    const { id } = req.params;
    const { assigned_to } = req.body;
    
    db.run(
        `UPDATE incidents SET 
         assigned_to = ?, status = 'assigned', updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [assigned_to, id],
        function(err) {
            if (err) {
                return res.status(500).json({ message: 'Error al asignar incidencia' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ message: 'Incidencia no encontrada' });
            }
            
            res.json({ message: 'Incidencia asignada exitosamente' });
        }
    );
});

// Resolver incidencia
router.put('/:id/resolve', authenticateToken, [
    body('solution').notEmpty().withMessage('Solución es requerida')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    
    const { id } = req.params;
    const { solution } = req.body;
    
    db.run(
        `UPDATE incidents SET 
         solution = ?, status = 'resolved', resolved_date = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [solution, id],
        function(err) {
            if (err) {
                return res.status(500).json({ message: 'Error al resolver incidencia' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ message: 'Incidencia no encontrada' });
            }
            
            res.json({ message: 'Incidencia resuelta exitosamente' });
        }
    );
});

// Obtener estadísticas de incidencias
router.get('/stats/overview', authenticateToken, (req, res) => {
    const queries = {
        total: `SELECT COUNT(*) as count FROM incidents`,
        byStatus: `SELECT status, COUNT(*) as count FROM incidents GROUP BY status`,
        byPriority: `SELECT priority, COUNT(*) as count FROM incidents GROUP BY priority`,
        open: `SELECT COUNT(*) as count FROM incidents WHERE status IN ('open', 'assigned', 'in_progress')`,
        resolved: `SELECT COUNT(*) as count FROM incidents WHERE status = 'resolved'`,
        avgResolutionTime: `
            SELECT AVG(JULIANDAY(resolved_date) - JULIANDAY(reported_date)) * 24 as avg_hours
            FROM incidents 
            WHERE resolved_date IS NOT NULL
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