const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '..', 'siaf.db'));

// Crear tablas
db.serialize(() => {
    // Tabla de usuarios
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        department VARCHAR(50),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        active BOOLEAN DEFAULT 1
    )`);

    // Tabla de categorías de activos
    db.run(`CREATE TABLE IF NOT EXISTS asset_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(50) NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabla de activos/inventario
    db.run(`CREATE TABLE IF NOT EXISTS assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_code VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        category_id INTEGER,
        brand VARCHAR(50),
        model VARCHAR(50),
        serial_number VARCHAR(100),
        purchase_date DATE,
        purchase_price DECIMAL(10,2),
        supplier VARCHAR(100),
        location VARCHAR(100),
        status VARCHAR(20) DEFAULT 'active',
        responsible_user_id INTEGER,
        warranty_expiry DATE,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES asset_categories(id),
        FOREIGN KEY (responsible_user_id) REFERENCES users(id)
    )`);

    // Tabla de incidencias
    db.run(`CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_code VARCHAR(20) UNIQUE NOT NULL,
        title VARCHAR(100) NOT NULL,
        description TEXT NOT NULL,
        asset_id INTEGER,
        priority VARCHAR(10) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'open',
        reported_by INTEGER,
        assigned_to INTEGER,
        reported_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_date DATETIME,
        solution TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (asset_id) REFERENCES assets(id),
        FOREIGN KEY (reported_by) REFERENCES users(id),
        FOREIGN KEY (assigned_to) REFERENCES users(id)
    )`);

    // Tabla de mantenimientos
    db.run(`CREATE TABLE IF NOT EXISTS maintenances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        maintenance_code VARCHAR(20) UNIQUE NOT NULL,
        asset_id INTEGER NOT NULL,
        type VARCHAR(20) DEFAULT 'preventive',
        title VARCHAR(100) NOT NULL,
        description TEXT,
        scheduled_date DATE,
        completed_date DATE,
        status VARCHAR(20) DEFAULT 'scheduled',
        technician_id INTEGER,
        cost DECIMAL(10,2),
        supplier VARCHAR(100),
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (asset_id) REFERENCES assets(id),
        FOREIGN KEY (technician_id) REFERENCES users(id)
    )`);

    // Tabla de formatos responsivos
    db.run(`CREATE TABLE IF NOT EXISTS responsive_forms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        form_code VARCHAR(20) UNIQUE NOT NULL,
        asset_id INTEGER NOT NULL,
        previous_responsible_id INTEGER,
        new_responsible_id INTEGER NOT NULL,
        transfer_date DATE NOT NULL,
        reason TEXT,
        conditions TEXT,
        observations TEXT,
        approved_by INTEGER,
        status VARCHAR(20) DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (asset_id) REFERENCES assets(id),
        FOREIGN KEY (previous_responsible_id) REFERENCES users(id),
        FOREIGN KEY (new_responsible_id) REFERENCES users(id),
        FOREIGN KEY (approved_by) REFERENCES users(id)
    )`);

    // Tabla de requisiciones
    db.run(`CREATE TABLE IF NOT EXISTS requisitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requisition_code VARCHAR(20) UNIQUE NOT NULL,
        type VARCHAR(20) DEFAULT 'purchase',
        title VARCHAR(100) NOT NULL,
        description TEXT,
        requested_by INTEGER NOT NULL,
        department VARCHAR(50),
        priority VARCHAR(10) DEFAULT 'medium',
        estimated_cost DECIMAL(10,2),
        justification TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        approved_by INTEGER,
        approval_date DATETIME,
        completion_date DATETIME,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (requested_by) REFERENCES users(id),
        FOREIGN KEY (approved_by) REFERENCES users(id)
    )`);

    // Tabla de items de requisición
    db.run(`CREATE TABLE IF NOT EXISTS requisition_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requisition_id INTEGER NOT NULL,
        item_name VARCHAR(100) NOT NULL,
        description TEXT,
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10,2),
        total_price DECIMAL(10,2),
        FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE
    )`);

    // Insertar datos iniciales
    const adminPassword = bcrypt.hashSync('admin123', 10);
    
    // Usuario administrador por defecto
    db.run(`INSERT OR IGNORE INTO users (username, email, password, full_name, role, department) 
            VALUES ('admin', 'admin@beachscape.com', ?, 'Administrador del Sistema', 'admin', 'Sistemas')`, 
            [adminPassword]);

    // Categorías de activos por defecto
    const categories = [
        'Computadoras',
        'Impresoras',
        'Cámaras de Seguridad',
        'Equipos de Red',
        'Software',
        'Mobiliario de Oficina',
        'Equipos de Audio/Video',
        'Otros'
    ];

    categories.forEach(category => {
        db.run(`INSERT OR IGNORE INTO asset_categories (name) VALUES (?)`, [category]);
    });

    console.log('Base de datos inicializada correctamente');
    console.log('Usuario por defecto creado: admin / admin123');
});

db.close();