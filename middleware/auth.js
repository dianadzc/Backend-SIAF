const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET || 'siaf_hotel_beachscape_secret_2024';

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ message: 'Token de acceso requerido' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Token inválido' });
        }
        req.user = user;
        next();
    });
};

const authorizeRole = (roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'No autorizado' });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Permisos insuficientes' });
        }

        next();
    };
};

const generateToken = (user) => {
    return jwt.sign(
        { 
            id: user.id, 
            username: user.username, 
            email: user.email, 
            role: user.role,
            full_name: user.full_name,
            department: user.department
        },
        JWT_SECRET,
        { expiresIn: '8h' }
    );
};

module.exports = {
    authenticateToken,
    authorizeRole,
    generateToken,
    JWT_SECRET
};