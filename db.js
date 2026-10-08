
const mysql = require('mysql2/promise');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword, isDefaultAdminPasswordHash } = require('./passwords');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'food_ordering_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

const sqliteDbPath = process.env.SQLITE_DB_PATH
  ? path.resolve(process.env.SQLITE_DB_PATH)
  : path.join(__dirname, 'data', 'food-ordering-app.db');
fs.mkdirSync(path.dirname(sqliteDbPath), { recursive: true });

let pool = null;
let sqliteDb = null;

async function ensureDatabase() {
  try {
    const connection = await mysql.createConnection({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
    });

    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\``);
    await connection.end();

    pool = mysql.createPool(dbConfig);
    return 'mysql';
  } catch (error) {
    console.warn('MySQL not available; using local SQLite database instead.', error.message);
    sqliteDb = new sqlite3.Database(sqliteDbPath);
    return 'sqlite';
  }
}

function sqliteRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function (err) {
      if (err) {
        reject(err);
        return;
      }

      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function sqliteAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows);
    });
  });
}

function sqliteGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(row || null);
    });
  });
}

async function run(sql, params = []) {
  if (sqliteDb) {
    return sqliteRun(sql, params);
  }

  const [result] = await pool.execute(sql, params);
  return { id: result.insertId, changes: result.affectedRows };
}

async function all(sql, params = []) {
  if (sqliteDb) {
    return sqliteAll(sql, params);
  }

  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function get(sql, params = []) {
  if (sqliteDb) {
    return sqliteGet(sql, params);
  }

  const rows = await all(sql, params);
  return rows[0] || null;
}

async function withTransaction(callback) {
  if (sqliteDb) {
    await sqliteRun('BEGIN IMMEDIATE');
    try {
      const result = await callback({ run: sqliteRun, get: sqliteGet, all: sqliteAll });
      await sqliteRun('COMMIT');
      return result;
    } catch (error) {
      await sqliteRun('ROLLBACK');
      throw error;
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const transaction = {
      run: async (sql, params = []) => {
        const [result] = await connection.execute(sql, params);
        return { id: result.insertId, changes: result.affectedRows };
      },
      all: async (sql, params = []) => {
        const [rows] = await connection.execute(sql, params);
        return rows;
      },
      get: async (sql, params = []) => {
        const [rows] = await connection.execute(sql, params);
        return rows[0] || null;
      }
    };
    const result = await callback(transaction);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function initializeDatabase() {
  const mode = await ensureDatabase();

  if (mode === 'sqlite') {
    await sqliteRun(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        category TEXT,
        image TEXT
      )
    `);

    await sqliteRun(`
      CREATE TABLE IF NOT EXISTS menu_schedule (
        day_of_week INTEGER NOT NULL,
        menu_item_id INTEGER NOT NULL,
        PRIMARY KEY (day_of_week, menu_item_id),
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
      )
    `);

    await sqliteRun(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        address TEXT NOT NULL,
        note TEXT,
        status TEXT DEFAULT 'Pending',
        total DECIMAL(10,2) NOT NULL,
        payment_method TEXT NOT NULL DEFAULT 'cash',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await sqliteRun(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        menu_item_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id),
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
      )
    `);

    await sqliteRun(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'staff',
        session_version INTEGER NOT NULL DEFAULT 0,
        age INTEGER,
        weight DECIMAL(5,2),
        height DECIMAL(5,2),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } else {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        category VARCHAR(100),
        image TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS menu_schedule (
        day_of_week INT NOT NULL,
        menu_item_id INT NOT NULL,
        PRIMARY KEY (day_of_week, menu_item_id),
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        address TEXT NOT NULL,
        note TEXT,
        status VARCHAR(100) DEFAULT 'Pending',
        total DECIMAL(10,2) NOT NULL,
        payment_method VARCHAR(16) NOT NULL DEFAULT 'cash',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        menu_item_id INT NOT NULL,
        quantity INT NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id),
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        username VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'staff',
        session_version INT NOT NULL DEFAULT 0,
        age INT,
        weight DECIMAL(5,2),
        height DECIMAL(5,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  if (sqliteDb) {
    const columns = await sqliteAll('PRAGMA table_info(users)');
    const existingColumns = new Set(columns.map((column) => column.name));
    const columnDefinitions = [
      { name: 'age', sql: 'ALTER TABLE users ADD COLUMN age INTEGER' },
      { name: 'session_version', sql: 'ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0' },
      { name: 'weight', sql: 'ALTER TABLE users ADD COLUMN weight DECIMAL(5,2)' },
      { name: 'height', sql: 'ALTER TABLE users ADD COLUMN height DECIMAL(5,2)' },
      { name: 'wallet_balance_cents', sql: 'ALTER TABLE users ADD COLUMN wallet_balance_cents INTEGER NOT NULL DEFAULT 0' }
    ];

    for (const column of columnDefinitions) {
      if (!existingColumns.has(column.name)) {
        await sqliteRun(column.sql);
      }
    }
  } else {
    const [rows] = await pool.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'`,
      [dbConfig.database]
    );
    const existingColumns = new Set(rows.map((row) => row.COLUMN_NAME));
    const columnDefinitions = [
      { name: 'age', sql: 'ALTER TABLE users ADD COLUMN age INT' },
      { name: 'session_version', sql: 'ALTER TABLE users ADD COLUMN session_version INT NOT NULL DEFAULT 0' },
      { name: 'weight', sql: 'ALTER TABLE users ADD COLUMN weight DECIMAL(5,2)' },
      { name: 'height', sql: 'ALTER TABLE users ADD COLUMN height DECIMAL(5,2)' }
    ];

    for (const column of columnDefinitions) {
      if (!existingColumns.has(column.name)) {
        await pool.query(column.sql);
      }
    }
  }

  if (sqliteDb) {
    const columns = await sqliteAll('PRAGMA table_info(orders)');
    if (!columns.some((column) => column.name === 'user_id')) {
      await sqliteRun('ALTER TABLE orders ADD COLUMN user_id INTEGER');
    }
    if (!columns.some((column) => column.name === 'payment_method')) {
      await sqliteRun("ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash'");
    }
    await sqliteRun(`
      CREATE TABLE IF NOT EXISTS account_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount_cents INTEGER NOT NULL,
        type TEXT NOT NULL,
        order_id INTEGER,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } else {
    const [orderColumns] = await pool.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'orders'`,
      [dbConfig.database]
    );
    if (!orderColumns.some((column) => column.COLUMN_NAME === 'user_id')) {
      await pool.query('ALTER TABLE orders ADD COLUMN user_id INT NULL');
    }
    if (!orderColumns.some((column) => column.COLUMN_NAME === 'payment_method')) {
      await pool.query("ALTER TABLE orders ADD COLUMN payment_method VARCHAR(16) NOT NULL DEFAULT 'cash'");
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS account_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        amount_cents BIGINT NOT NULL,
        type VARCHAR(32) NOT NULL,
        order_id INT NULL,
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_account_transactions_user_created (user_id, created_at)
      )
    `);
  }

  const adminUser = await get('SELECT * FROM users WHERE username = ?', ['admin']);
  const configuredAdminPassword = process.env.ADMIN_PASSWORD;
  if (configuredAdminPassword && configuredAdminPassword.length < 16) {
    throw new Error('ADMIN_PASSWORD must be at least 16 characters long.');
  }

  if (!adminUser) {
    const initialPassword = configuredAdminPassword || crypto.randomBytes(24).toString('base64url');
    await run(
      'INSERT INTO users (full_name, username, password, role) VALUES (?, ?, ?, ?)',
      ['System Administrator', 'admin', await hashPassword(initialPassword), 'admin']
    );
    if (!configuredAdminPassword) {
      console.log(`One-time initial admin password (copy it now): ${initialPassword}`);
    }
  } else if (isDefaultAdminPasswordHash(adminUser.password)) {
    const replacementPassword = configuredAdminPassword || crypto.randomBytes(24).toString('base64url');
    await run(
      'UPDATE users SET password = ? WHERE username = ?',
      [await hashPassword(replacementPassword), 'admin']
    );
    if (!configuredAdminPassword) {
      console.warn(`The insecure default admin password was replaced. New one-time admin password: ${replacementPassword}`);
    }
  }

  const countRows = await all('SELECT COUNT(*) AS count FROM menu_items');
  if (!countRows[0] || Number(countRows[0].count) === 0) {
    await run(`
      INSERT INTO menu_items (name, description, price, category, image)
      VALUES
        ('Beef Burger', 'Juicy grilled beef patty with lettuce, tomato and cheese.', 14.50, 'Burgers', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80'),
        ('Chicken Wrap', 'Crispy chicken, slaw, and spicy mayo in a soft wrap.', 12.00, 'Wraps', 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=900&q=80'),
        ('Rice & Stew', 'Traditional savory stew served with fluffy rice.', 16.00, 'Meals', 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=900&q=80'),
        ('Noodles Special', 'Stir-fried noodles with vegetables and choice of protein.', 15.50, 'Noodles', 'https://images.unsplash.com/photo-1516100882582-96c3a05fe590?auto=format&fit=crop&w=900&q=80'),
        ('Chips & Chicken', 'Crispy fries with seasoned chicken pieces and dip.', 13.75, 'Sides', 'https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=900&q=80'),
        ('Fruit Smoothie', 'Refreshing fruit blend with yogurt and ice.', 8.50, 'Drink', 'https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=900&q=80')
    `);
  }

  await run("UPDATE menu_items SET category = 'Drink' WHERE category = 'Drinks'");

  const scheduleCount = await get('SELECT COUNT(*) AS count FROM menu_schedule');
  if (Number(scheduleCount.count) === 0) {
    const menuItems = await all('SELECT id FROM menu_items');
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
      for (const item of menuItems) {
        await run(
          'INSERT INTO menu_schedule (day_of_week, menu_item_id) VALUES (?, ?)',
          [dayOfWeek, item.id]
        );
      }
    }
  }

  const drinkOptions = [
    ['Minute Maid', 'Chilled Minute Maid fruit juice.', 2.00],
    ['Pepsi', 'Chilled Pepsi soft drink.', 1.50],
    ['Coca-Cola', 'Chilled Coke soft drink.', 1.50]
  ];
  for (const [name, description, price] of drinkOptions) {
    const existingDrink = await get('SELECT id FROM menu_items WHERE name = ? LIMIT 1', [name]);
    if (existingDrink) continue;

    const result = await run(
      'INSERT INTO menu_items (name, description, price, category, image) VALUES (?, ?, ?, ?, ?)',
      [name, description, price, 'Drink', '/drinks-assortment.svg']
    );
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
      await run(
        'INSERT INTO menu_schedule (day_of_week, menu_item_id) VALUES (?, ?)',
        [dayOfWeek, result.id]
      );
    }
  }
}

async function replaceMenuSchedule(entries) {
  if (sqliteDb) {
    await sqliteRun('BEGIN TRANSACTION');
    try {
      await sqliteRun('DELETE FROM menu_schedule');
      for (const entry of entries) {
        await sqliteRun(
          'INSERT INTO menu_schedule (day_of_week, menu_item_id) VALUES (?, ?)',
          [entry.dayOfWeek, entry.menuItemId]
        );
      }
      await sqliteRun('COMMIT');
    } catch (error) {
      await sqliteRun('ROLLBACK');
      throw error;
    }
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM menu_schedule');
    for (const entry of entries) {
      await connection.execute(
        'INSERT INTO menu_schedule (day_of_week, menu_item_id) VALUES (?, ?)',
        [entry.dayOfWeek, entry.menuItemId]
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { pool, run, get, all, withTransaction, initializeDatabase, replaceMenuSchedule };
