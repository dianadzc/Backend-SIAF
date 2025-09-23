const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const db = new sqlite3.Database(path.join(__dirname, '..', 'siaf.db'));

// Dashboard general con estadísticas principales
router.get('/dashboard', authenticateToken, (req, res) => {
    const queries = {
        // Inventario
        totalAssets: `SELECT COUNT(*) as count FROM assets WHERE status != 'inactive'`,
        assetsByCategory: `
            SELECT c.name, COUNT(a.id) as count 
            FROM asset_categories c 
            LEFT JOIN assets a ON c.id = a.category_id AND a.status != 'inactive'
            GROUP BY c.id, c.name
        `,
        assetsWithoutResponsible: `
            SELECT COUNT(*) as count FROM assets 
            WHERE responsible_user_id IS NULL AND status = 'active'
        `,
        expiredWarranties: `
            SELECT COUNT(*) as count FROM assets 
            WHERE warranty_expiry < DATE('now') AND status = 'active'
        `,
        
        // Incidencias
        totalIncidents: `SELECT COUNT(*) as count FROM incidents`,
        openIncidents: `
            SELECT COUNT(*) as count FROM incidents 
            WHERE status IN ('open', 'assigned', 'in_progress')
        `,
        incidentsByPriority: `SELECT priority, COUNT(*) as count FROM incidents GROUP BY priority`,
        
        // Mantenimientos
        totalMaintenances: `SELECT COUNT(*) as count FROM maintenances`,
        upcomingMaintenances: `
            SELECT COUNT(*) as count FROM maintenances 
            WHERE scheduled_date BETWEEN DATE('now') AND DATE('now', '+30 days') 
            AND status = 'scheduled'
        `,
        overdueMaintenances: `
            SELECT COUNT(*) as count FROM maintenances 
            WHERE scheduled_date < DATE('now') AND status = 'scheduled'
        `,
        
        // Formatos responsivos
        pendingForms: `SELECT COUNT(*) as count FROM responsive_forms WHERE status = 'pending'`,
        
        // Requisiciones
        pendingRequisitions: `SELECT COUNT(*) as count FROM requisitions WHERE status = 'pending'`,
        approvedRequisitionsValue: `
            SELECT SUM(estimated_cost) as total FROM requisitions 
            WHERE status = 'approved' AND created_at >= DATE('now', '-30 days')
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
            res.json({ dashboard: stats });
        })
        .catch(err => {
            res.status(500).json({ message: 'Error al obtener estadísticas del dashboard' });
        });
});

// Reporte de inventario con filtros
router.get('/inventory', authenticateToken, (req, res) => {
    const { category, status, responsible, dateFrom, dateTo, format = 'json' } = req.query;
    
    let query = `
        SELECT 
            a.*,
            c.name as category_name,
            u.full_name as responsible_name,
            u.department as responsible_department
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
    
    if (responsible) {
        query += ` AND a.responsible_user_id = ?`;
        params.push(responsible);
    }
    
    if (dateFrom) {
        query += ` AND a.created_at >= ?`;
        params.push(dateFrom);
    }
    
    if (dateTo) {
        query += ` AND a.created_at <= ?`;
        params.push(dateTo + ' 23:59:59');
    }
    
    query += ` ORDER BY a.created_at DESC`;
    
    db.all(query, params, (err, assets) => {
        if (err) {
            return res.status(500).json({ message: 'Error al generar reporte de inventario' });
        }
        
        const reportData = {
            title: 'Reporte de Inventario',
            generatedAt: new Date().toISOString(),
            filters: { category, status, responsible, dateFrom, dateTo },
            data: assets,
            summary: {
                totalAssets: assets.length,
                byCategory: assets.reduce((acc, asset) => {
                    const cat = asset.category_name || 'Sin categoría';
                    acc[cat] = (acc[cat] || 0) + 1;
                    return acc;
                }, {}),
                byStatus: assets.reduce((acc, asset) => {
                    acc[asset.status] = (acc[asset.status] || 0) + 1;
                    return acc;
                }, {}),
                totalValue: assets.reduce((sum, asset) => sum + (asset.purchase_price || 0), 0)
            }
        };
        
        res.json(reportData);
    });
});

// Reporte de incidencias
router.get('/incidents', authenticateToken, (req, res) => {
    const { status, priority, asset_id, dateFrom, dateTo } = req.query;
    
    let query = `
        SELECT 
            i.*,
            a.name as asset_name,
            a.asset_code,
            reporter.full_name as reported_by_name,
            assignee.full_name as assigned_to_name,
            CASE 
                WHEN i.resolved_date IS NOT NULL THEN
                    ROUND((JULIANDAY(i.resolved_date) - JULIANDAY(i.reported_date)) * 24, 2)
                ELSE NULL
            END as resolution_hours
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
    
    if (dateFrom) {
        query += ` AND i.reported_date >= ?`;
        params.push(dateFrom);
    }
    
    if (dateTo) {
        query += ` AND i.reported_date <= ?`;
        params.push(dateTo + ' 23:59:59');
    }
    
    query += ` ORDER BY i.reported_date DESC`;
    
    db.all(query, params, (err, incidents) => {
        if (err) {
            return res.status(500).json({ message: 'Error al generar reporte de incidencias' });
        }
        
        const resolvedIncidents = incidents.filter(i => i.resolution_hours !== null);
        const avgResolutionTime = resolvedIncidents.length > 0 
            ? resolvedIncidents.reduce((sum, i) => sum + i.resolution_hours, 0) / resolvedIncidents.length
            : 0;
        
        const reportData = {
            title: 'Reporte de Incidencias',
            generatedAt: new Date().toISOString(),
            filters: { status, priority, asset_id, dateFrom, dateTo },
            data: incidents,
            summary: {
                totalIncidents: incidents.length,
                byStatus: incidents.reduce((acc, incident) => {
                    acc[incident.status] = (acc[incident.status] || 0) + 1;
                    return acc;
                }, {}),
                byPriority: incidents.reduce((acc, incident) => {
                    acc[incident.priority] = (acc[incident.priority] || 0) + 1;
                    return acc;
                }, {}),
                averageResolutionTime: Math.round(avgResolutionTime * 100) / 100,
                resolvedCount: resolvedIncidents.length
            }
        };
        
        res.json(reportData);
    });
});

// Reporte de mantenimientos
router.get('/maintenance', authenticateToken, (req, res) => {
    const { type, status, asset_id, dateFrom, dateTo } = req.query;
    
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
    
    if (type) {
        query += ` AND m.type = ?`;
        params.push(type);
    }
    
    if (status) {
        query += ` AND m.status = ?`;
        params.push(status);
    }
    
    if (asset_id) {
        query += ` AND m.asset_id = ?`;
        params.push(asset_id);
    }
    
    if (dateFrom) {
        query += ` AND m.scheduled_date >= ?`;
        params.push(dateFrom);
    }
    
    if (dateTo) {
        query += ` AND m.scheduled_date <= ?`;
        params.push(dateTo);
    }
    
    query += ` ORDER BY m.scheduled_date DESC`;
    
    db.all(query, params, (err, maintenances) => {
        if (err) {
            return res.status(500).json({ message: 'Error al generar reporte de mantenimientos' });
        }
        
        const reportData = {
            title: 'Reporte de Mantenimientos',
            generatedAt: new Date().toISOString(),
            filters: { type, status, asset_id, dateFrom, dateTo },
            data: maintenances,
            summary: {
                totalMaintenances: maintenances.length,
                byType: maintenances.reduce((acc, maintenance) => {
                    acc[maintenance.type] = (acc[maintenance.type] || 0) + 1;
                    return acc;
                }, {}),
                byStatus: maintenances.reduce((acc, maintenance) => {
                    acc[maintenance.status] = (acc[maintenance.status] || 0) + 1;
                    return acc;
                }, {}),
                totalCost: maintenances.reduce((sum, m) => sum + (m.cost || 0), 0),
                completedCount: maintenances.filter(m => m.status === 'completed').length
            }
        };
        
        res.json(reportData);
    });
});

// Reporte de formatos responsivos
router.get('/responsive-forms', authenticateToken, (req, res) => {
    const { status, asset_id, dateFrom, dateTo } = req.query;
    
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
    
    if (dateFrom) {
        query += ` AND rf.transfer_date >= ?`;
        params.push(dateFrom);
    }
    
    if (dateTo) {
        query += ` AND rf.transfer_date <= ?`;
        params.push(dateTo);
    }
    
    query += ` ORDER BY rf.transfer_date DESC`;
    
    db.all(query, params, (err, forms) => {
        if (err) {
            return res.status(500).json({ message: 'Error al generar reporte de formatos responsivos' });
        }
        
        const reportData = {
            title: 'Reporte de Formatos Responsivos',
            generatedAt: new Date().toISOString(),
            filters: { status, asset_id, dateFrom, dateTo },
            data: forms,
            summary: {
                totalForms: forms.length,
                byStatus: forms.reduce((acc, form) => {
                    acc[form.status] = (acc[form.status] || 0) + 1;
                    return acc;
                }, {}),
                approvedCount: forms.filter(f => f.status === 'approved').length,
                pendingCount: forms.filter(f => f.status === 'pending').length
            }
        };
        
        res.json(reportData);
    });
});

// Reporte de requisiciones
router.get('/requisitions', authenticateToken, (req, res) => {
    const { status, type, department, dateFrom, dateTo } = req.query;
    
    let query = `
        SELECT 
            r.*,
            requester.full_name as requested_by_name,
            approver.full_name as approved_by_name
        FROM requisitions r
        LEFT JOIN users requester ON r.requested_by = requester.id
        LEFT JOIN users approver ON r.approved_by = approver.id
        WHERE 1=1
    `;
    
    let params = [];
    
    if (status) {
        query += ` AND r.status = ?`;
        params.push(status);
    }
    
    if (type) {
        query += ` AND r.type = ?`;
        params.push(type);
    }
    
    if (department) {
        query += ` AND r.department = ?`;
        params.push(department);
    }
    
    if (dateFrom) {
        query += ` AND r.created_at >= ?`;
        params.push(dateFrom);
    }
    
    if (dateTo) {
        query += ` AND r.created_at <= ?`;
        params.push(dateTo + ' 23:59:59');
    }
    
    query += ` ORDER BY r.created_at DESC`;
    
    db.all(query, params, (err, requisitions) => {
        if (err) {
            return res.status(500).json({ message: 'Error al generar reporte de requisiciones' });
        }
        
        const reportData = {
            title: 'Reporte de Requisiciones',
            generatedAt: new Date().toISOString(),
            filters: { status, type, department, dateFrom, dateTo },
            data: requisitions,
            summary: {
                totalRequisitions: requisitions.length,
                byStatus: requisitions.reduce((acc, req) => {
                    acc[req.status] = (acc[req.status] || 0) + 1;
                    return acc;
                }, {}),
                byType: requisitions.reduce((acc, req) => {
                    acc[req.type] = (acc[req.type] || 0) + 1;
                    return acc;
                }, {}),
                totalEstimatedCost: requisitions.reduce((sum, req) => sum + (req.estimated_cost || 0), 0),
                approvedValue: requisitions
                    .filter(req => req.status === 'approved' || req.status === 'completed')
                    .reduce((sum, req) => sum + (req.estimated_cost || 0), 0)
            }
        };
        
        res.json(reportData);
    });
});

// Reporte de actividad de usuarios
router.get('/user-activity', authenticateToken, (req, res) => {
    const { user_id, dateFrom, dateTo } = req.query;
    
    const queries = {
        incidents_reported: `
            SELECT COUNT(*) as count FROM incidents 
            WHERE reported_by = ? 
            ${dateFrom ? 'AND reported_date >= ?' : ''}
            ${dateTo ? 'AND reported_date <= ?' : ''}
        `,
        incidents_assigned: `
            SELECT COUNT(*) as count FROM incidents 
            WHERE assigned_to = ?
            ${dateFrom ? 'AND reported_date >= ?' : ''}
            ${dateTo ? 'AND reported_date <= ?' : ''}
        `,
        maintenances_assigned: `
            SELECT COUNT(*) as count FROM maintenances 
            WHERE technician_id = ?
            ${dateFrom ? 'AND scheduled_date >= ?' : ''}
            ${dateTo ? 'AND scheduled_date <= ?' : ''}
        `,
        requisitions_made: `
            SELECT COUNT(*) as count FROM requisitions 
            WHERE requested_by = ?
            ${dateFrom ? 'AND created_at >= ?' : ''}
            ${dateTo ? 'AND created_at <= ?' : ''}
        `,
        forms_approved: `
            SELECT COUNT(*) as count FROM responsive_forms 
            WHERE approved_by = ?
            ${dateFrom ? 'AND created_at >= ?' : ''}
            ${dateTo ? 'AND created_at <= ?' : ''}
        `
    };
    
    if (!user_id) {
        return res.status(400).json({ message: 'ID de usuario requerido' });
    }
    
    const activity = {};
    const promises = [];
    
    Object.keys(queries).forEach(key => {
        promises.push(new Promise((resolve, reject) => {
            let params = [user_id];
            if (dateFrom) params.push(dateFrom);
            if (dateTo) params.push(dateTo + ' 23:59:59');
            
            db.get(queries[key], params, (err, result) => {
                if (err) reject(err);
                else {
                    activity[key] = result.count;
                    resolve();
                }
            });
        }));
    });
    
    Promise.all(promises)
        .then(() => {
            res.json({
                title: 'Reporte de Actividad de Usuario',
                user_id,
                dateFrom,
                dateTo,
                activity
            });
        })
        .catch(err => {
            res.status(500).json({ message: 'Error al generar reporte de actividad' });
        });
});

module.exports = router;