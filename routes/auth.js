const express = require('express');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { body, validationResult } = require('express-validator');
const { authenticateToken, generateToken } = require('../middleware/auth');

const router = express.Router();
const db = new sqlite3.Database(path.join(__dirname, '..', 'siaf.db'));

// Login
router.post('/login', [
    body('username').notEmpty().withMessage('Usuario es requerido'),
    body('password').notEmpty().withMessage('Contraseña es requerida')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    db.get(
        `SELECT * FROM users WHERE (username = ? OR email = ?) AND active = 1`,
        [username, username],
        (err, user) => {
            if (err) {
                return res.status(500).json({ message: 'Error del servidor' });
            }

            if (!user) {
                return res.status(401).json({ message: 'Credenciales inválidas' });
            }

            bcrypt.compare(password, user.password, (err, isValid) => {
                if (err || !isValid) {
                    return res.status(401).json({ message: 'Credenciales inválidas' });
                }

                const token = generateToken(user);
                
                // Actualizar última conexión
                db.run(`UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [user.id]);

                res.json({
                    message: 'Login exitoso',
                    token,
                    user: {
                        id: user.id,
                        username: user.username,
                        email: user.email,
                        full_name: user.full_name,
                        role: user.role,
                        department: user.department
                    }
                });
            });
        }
    );
});

// Registro de usuarios (solo admin)
router.post('/register', authenticateToken, [
    body('username').isLength({ min: 3 }).withMessage('Usuario debe tener al menos 3 caracteres'),
    body('email').isEmail().withMessage('Email inválido'),
    body('password').isLength({ min: 6 }).withMessage('Contraseña debe tener al menos 6 caracteres'),
    body('full_name').notEmpty().withMessage('Nombre completo es requerido')
], (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Solo administradores pueden registrar usuarios' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password, full_name, role = 'user', department } = req.body;

    // Verificar si usuario o email ya existen
    db.get(
        `SELECT * FROM users WHERE username = ? OR email = ?`,
        [username, email],
        (err, existingUser) => {
            if (err) {
                return res.status(500).json({ message: 'Error del servidor' });
            }

            if (existingUser) {
                return res.status(400).json({ message: 'Usuario o email ya existen' });
            }

            // Hash de la contraseña
            bcrypt.hash(password, 10, (err, hashedPassword) => {
                if (err) {
                    return res.status(500).json({ message: 'Error al procesar contraseña' });
                }

                db.run(
                    `INSERT INTO users (username, email, password, full_name, role, department) 
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [username, email, hashedPassword, full_name, role, department],
                    function(err) {
                        if (err) {
                            return res.status(500).json({ message: 'Error al crear usuario' });
                        }

                        res.status(201).json({
                            message: 'Usuario creado exitosamente',
                            user: {
                                id: this.lastID,
                                username,
                                email,
                                full_name,
                                role,
                                department
                            }
                        });
                    }
                );
            });
        }
    );
});

// Obtener perfil del usuario
router.get('/profile', authenticateToken, (req, res) => {
    db.get(
        `SELECT id, username, email, full_name, role, department, created_at FROM users WHERE id = ?`,
        [req.user.id],
        (err, user) => {
            if (err) {
                return res.status(500).json({ message: 'Error del servidor' });
            }

            if (!user) {
                return res.status(404).json({ message: 'Usuario no encontrado' });
            }

            res.json({ user });
        }
    );
});

// Cambiar contraseña
router.put('/change-password', authenticateToken, [
    body('currentPassword').notEmpty().withMessage('Contraseña actual requerida'),
    body('newPassword').isLength({ min: 6 }).withMessage('Nueva contraseña debe tener al menos 6 caracteres')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;

    db.get(`SELECT password FROM users WHERE id = ?`, [req.user.id], (err, user) => {
        if (err) {
            return res.status(500).json({ message: 'Error del servidor' });
        }

        bcrypt.compare(currentPassword, user.password, (err, isValid) => {
            if (err || !isValid) {
                return res.status(400).json({ message: 'Contraseña actual incorrecta' });
            }

            bcrypt.hash(newPassword, 10, (err, hashedPassword) => {
                if (err) {
                    return res.status(500).json({ message: 'Error al procesar nueva contraseña' });
                }

                db.run(
                    `UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                    [hashedPassword, req.user.id],
                    (err) => {
                        if (err) {
                            return res.status(500).json({ message: 'Error al actualizar contraseña' });
                        }

                        res.json({ message: 'Contraseña actualizada exitosamente' });
                    }
                );
            });
        });
    });
});

module.exports = router;