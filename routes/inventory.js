const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { body, validationResult } = require('express-validator');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();
const db = new sqlite3.Database(path.join(__dirname, '..', 'siaf.db'));

// Obtener todos los activos con filtros y paginación
router.get('/', authenticateToken, (req, res) => {
    const { page = 1, limit = 10, category, status, search } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
        SELECT 
            a.*, 
            c.name as category_name,
            u.full_name as responsible_name
        FROM assets a
        LEFT JOIN asset_categories c ON a.category_id = c.id
        LEFT JOIN users u ON a.responsible_user_id = u.id
        WHERE 1=1
    `;
    
    let params = [];
    
    if (category) {
        query += ` AND a.category_id = ?`;
        params.push(category);
    }
    
    if (status) {
        query += ` AND a.status = ?`;
        params.push(status);
    }
    
    if (search) {
        query += ` AND (a.name LIKE ? OR a.asset_code LIKE ? OR a.brand LIKE ? OR a.model LIKE ?)`;
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    query += ` ORDER BY a.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);
    
    db.all(query, params, (err, assets) => {
        if (err) {
            return res.status(500).json({ message: 'Error al obtener activos' });
        }
        
        // Obtener total para paginación
        let countQuery = `SELECT COUNT(*) as total FROM assets a WHERE 1=1`;
        let countParams = [];
        
        if (category) {
            countQuery += ` AND a.category_id = ?`;
            countParams.push(category);
        }
        
        if (status) {
            countQuery += ` AND a.status = ?`;
            countParams.push(status);
        }
        
        if (search) {
            countQuery += ` AND (a.name LIKE ? OR a.asset_code LIKE ? OR a.brand LIKE ? OR a.model LIKE ?)`;
            const searchTerm = `%${search}%`;
            countParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }
        
        db.get(countQuery, countParams, (err, countResult) => {
            if (err) {
                return res.status(500).json({ message: 'Error al contar activos' });
            }
            
            res.json({
                assets,
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

// Obtener un activo específico
router.get('/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    
    const query = `
        SELECT 
            a.*, 
            c.name as category_name,
            u.full_name as responsible_name
        FROM assets a
        LEFT JOIN asset_categories c ON a.category_id = c.id
        LEFT JOIN users u ON a.responsible_user_id = u.id
        WHERE a.id = ?
    `;
    
    db.get(query, [id], (err, asset) => {
        if (err) {
            return res.status(500).json({ message: 'Error al obtener activo' });
        }
        
        if (!asset) {
            return res.status(404).json({ message: 'Activo no encontrado' });
        }
        
        res.json({ asset });
    });
});

// Crear nuevo activo
router.post('/', authenticateToken, [
    body('name').notEmpty().withMessage('Nombre del activo es requerido'),
    body('asset_code').notEmpty().withMessage('Código del activo es requerido'),
    body('category_id').isInt().withMessage('Categoría válida es requerida')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    
    const {
        asset_code, name, description, category_id, brand, model,
        serial_number, purchase_date, purchase_price, supplier,
        location, status = 'active', responsible_user_id,
        warranty_expiry, notes
    } = req.body;
    
    // Verificar que el código no exista
    db.get(`SELECT id FROM assets WHERE asset_code = ?`, [asset_code], (err, existing) => {
        if (err) {
            return res.status(500).json({ message: 'Error del servidor' });
        }
        
        if (existing) {
            return res.status(400).json({ message: 'El código del activo ya existe' });
        }
        
        const query = `
            INSERT INTO assets (
                asset_code, name, description, category_id, brand, model,
                serial_number, purchase_date, purchase_price, supplier,
                location, status, responsible_user_id, warranty_expiry, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
            asset_code, name, description, category_id, brand, model,
            serial_number, purchase_date, purchase_price, supplier,
            location, status, responsible_user_id, warranty_expiry, notes
        ], function(err) {
            if (err) {
                return res.status(500).json({ message: 'Error al crear activo' });
            }
            
            res.status(201).json({
                message: 'Activo creado exitosamente',
                asset: { id: this.lastID, asset_code, name, status }
            });
        });
    });
});

// Actualizar activo
router.put('/:id', authenticateToken, [
    body('name').notEmpty().withMessage('Nombre del activo es requerido'),
    body('category_id').isInt().withMessage('Categoría válida es requerida')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    
    const { id } = req.params;
    const {
        name, description, category_id, brand, model, serial_number,
        purchase_date, purchase_price, supplier, location, status,
        responsible_user_id, warranty_expiry, notes
    } = req.body;
    
    const query = `
        UPDATE assets SET
            name = ?, description = ?, category_id = ?, brand = ?, model = ?,
            serial_number = ?, purchase_date = ?, purchase_price = ?, supplier = ?,
            location = ?, status = ?, responsible_user_id = ?, warranty_expiry = ?,
            notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `;
    
    db.run(query, [
        name, description, category_id, brand, model, serial_number,
        purchase_date, purchase_price, supplier, location, status,
        responsible_user_id, warranty_expiry, notes, id
    ], function(err) {
        if (err) {
            return res.status(500).json({ message: 'Error al actualizar activo' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ message: 'Activo no encontrado' });
        }
        
        res.json({ message: 'Activo actualizado exitosamente' });
    });
});

// Eliminar activo (soft delete)
router.delete('/:id', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const { id } = req.params;
    
    db.run(
        `UPDATE assets SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [id],
        function(err) {
            if (err) {
                return res.status(500).json({ message: 'Error al eliminar activo' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ message: 'Activo no encontrado' });
            }
            
            res.json({ message: 'Activo eliminado exitosamente' });
        }
    );
});

// Obtener categorías
router.get('/categories/all', authenticateToken, (req, res) => {
    db.all(`SELECT * FROM asset_categories ORDER BY name`, (err, categories) => {
        if (err) {
            return res.status(500).json({ message: 'Error al obtener categorías' });
        }
        
        res.json({ categories });
    });
});

// Crear nueva categoría
router.post('/categories', authenticateToken, authorizeRole(['admin']), [
    body('name').notEmpty().withMessage('Nombre de la categoría es requerido')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    
    const { name, description } = req.body;
    
    db.run(
        `INSERT INTO asset_categories (name, description) VALUES (?, ?)`,
        [name, description],
        function(err) {
            if (err) {
                return res.status(500).json({ message: 'Error al crear categoría' });
            }
            
            res.status(201).json({
                message: 'Categoría creada exitosamente',
                category: { id: this.lastID, name, description }
            });
        }
    );
});

// Obtener estadísticas del inventario
router.get('/stats/overview', authenticateToken, (req, res) => {
    const queries = {
        total: `SELECT COUNT(*) as count FROM assets WHERE status != 'inactive'`,
        byStatus: `SELECT status, COUNT(*) as count FROM assets WHERE status != 'inactive' GROUP BY status`,
        byCategory: `
            SELECT c.name, COUNT(a.id) as count 
            FROM asset_categories c 
            LEFT JOIN assets a ON c.id = a.category_id AND a.status != 'inactive'
            GROUP BY c.id, c.name
        `,
        expiredWarranty: `
            SELECT COUNT(*) as count FROM assets 
            WHERE warranty_expiry < DATE('now') AND status = 'active'
        `,
        expiringWarranty: `
            SELECT COUNT(*) as count FROM assets 
            WHERE warranty_expiry BETWEEN DATE('now') AND DATE('now', '+30 days') 
            AND status = 'active'
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