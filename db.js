const mysql = require('mysql2/promise');
// Disabled: loading sqlite3 at startup crashes on Render (GLIBC_2.38 not found).
// It is now loaded only inside ensureDatabase() when the local SQLite fallback is used.
// const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
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
let postgresPool = null;

function postgresSql(sql) {
  let parameterIndex = 0;
  return sql.replace(/\?/g, () => `$${++parameterIndex}`);
}

function postgresRun(client, sql, params = []) {
  const isInsertWithId = /^\s*INSERT\s+INTO\s+(?!menu_schedule\b)/i.test(sql);
  const statement = isInsertWithId && !/\bRETURNING\b/i.test(sql)
    ? `${sql.trim().replace(/;$/, '')} RETURNING id`
    : sql;
  return client.query(postgresSql(statement), params).then((result) => ({
    id: result.rows[0] ? result.rows[0].id : null,
    changes: result.rowCount
  }));
}

async function ensureDatabase() {
  if (process.env.DATABASE_URL) {
    postgresPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: true },
      max: 10
    });
    try {
      await postgresPool.query('SELECT 1');
      return 'postgres';
    } catch (error) {
      await postgresPool.end();
      postgresPool = null;
      throw new Error(`Unable to connect to Neon PostgreSQL: ${error.message}`);
    }
  }

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
    const sqlite3 = require('sqlite3').verbose(); // loaded only for local SQLite fallback
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
  if (postgresPool) {
    return postgresRun(postgresPool, sql, params);
  }
  if (sqliteDb) {
    return sqliteRun(sql, params);
  }

  const [result] = await pool.execute(sql, params);
  return { id: result.insertId, changes: result.affectedRows };
}

async function all(sql, params = []) {
  if (postgresPool) {
    const result = await postgresPool.query(postgresSql(sql), params);
    return result.rows;
  }
  if (sqliteDb) {
    return sqliteAll(sql, params);
  }

  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function get(sql, params = []) {
  if (postgresPool) {
    const result = await postgresPool.query(postgresSql(sql), params);
    return result.rows[0] || null;
  }
  if (sqliteDb) {
    return sqliteGet(sql, params);
  }

  const rows = await all(sql, params);
  return rows[0] || null;
}

async function withTransaction(callback) {
  if (postgresPool) {
    const client = await postgresPool.connect();
    try {
      await client.query('BEGIN');
      const transaction = {
        run: (sql, params = []) => postgresRun(client, sql, params),
        all: async (sql, params = []) => (await client.query(postgresSql(sql), params)).rows,
        get: async (sql, params = []) => {
          const result = await client.query(postgresSql(sql), params);
          return result.rows[0] || null;
        }
      };
      const result = await callback(transaction);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
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

async function initializeDatabase({ seedData = true, requireEmpty = false } = {}) {
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        collected_at DATETIME
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
        email TEXT,
        session_version INTEGER NOT NULL DEFAULT 0,
        age INTEGER,
        weight DECIMAL(5,2),
        height DECIMAL(5,2),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } else if (mode === 'postgres') {
    await postgresPool.query(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        category VARCHAR(100),
        image TEXT,
        stock_quantity INTEGER NOT NULL DEFAULT 0
      )
    `);
    await postgresPool.query(`
      CREATE TABLE IF NOT EXISTS menu_schedule (
        day_of_week INTEGER NOT NULL,
        menu_item_id BIGINT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
        PRIMARY KEY (day_of_week, menu_item_id)
      )
    `);
    await postgresPool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id BIGSERIAL PRIMARY KEY,
        customer_name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        address TEXT NOT NULL,
        note TEXT,
        status VARCHAR(100) DEFAULT 'Pending',
        total DECIMAL(10,2) NOT NULL,
        payment_method VARCHAR(16) NOT NULL DEFAULT 'cash',
        user_id BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        collected_at TIMESTAMP
      )
    `);
    await postgresPool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id BIGSERIAL PRIMARY KEY,
        order_id BIGINT NOT NULL REFERENCES orders(id),
        menu_item_id BIGINT NOT NULL REFERENCES menu_items(id),
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL
      )
    `);
    await postgresPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        username VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'staff',
        email VARCHAR(255),
        session_version INTEGER NOT NULL DEFAULT 0,
        age INTEGER,
        weight DECIMAL(5,2),
        height DECIMAL(5,2),
        wallet_balance_cents BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await postgresPool.query(`
      CREATE TABLE IF NOT EXISTS stock_movements (
        id BIGSERIAL PRIMARY KEY,
        menu_item_id BIGINT NOT NULL,
        quantity_change INTEGER NOT NULL,
        type VARCHAR(16) NOT NULL,
        order_id BIGINT,
        created_by BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await postgresPool.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_movements_item_created
      ON stock_movements (menu_item_id, created_at)
    `);
    await postgresPool.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_movements_order ON stock_movements (order_id)
    `);
    await postgresPool.query(`
      CREATE TABLE IF NOT EXISTS account_transactions (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        amount_cents BIGINT NOT NULL,
        type VARCHAR(32) NOT NULL,
        order_id BIGINT,
        created_by BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await postgresPool.query(`
      CREATE INDEX IF NOT EXISTS idx_account_transactions_user_created
      ON account_transactions (user_id, created_at)
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        collected_at DATETIME NULL
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
        email VARCHAR(255),
        session_version INT NOT NULL DEFAULT 0,
        age INT,
        weight DECIMAL(5,2),
        height DECIMAL(5,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  if (postgresPool) {
    await postgresPool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS collected_at TIMESTAMP');
  } else if (sqliteDb) {
    const columns = await sqliteAll('PRAGMA table_info(orders)');
    if (!columns.some((column) => column.name === 'collected_at')) {
      await sqliteRun('ALTER TABLE orders ADD COLUMN collected_at DATETIME');
    }
  } else {
    const [columns] = await pool.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'orders'`,
      [dbConfig.database]
    );
    if (!columns.some((column) => column.COLUMN_NAME === 'collected_at')) {
      await pool.query('ALTER TABLE orders ADD COLUMN collected_at DATETIME NULL');
    }
  }
  if (!requireEmpty) {
    await run(
      `UPDATE orders
       SET collected_at = created_at
       WHERE status = 'Collected' AND collected_at IS NULL`
    );
  }

  if (postgresPool) {
    await postgresPool.query('ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS stock_quantity INTEGER NOT NULL DEFAULT 0');
  } else if (sqliteDb) {
    const columns = await sqliteAll('PRAGMA table_info(menu_items)');
    if (!columns.some((column) => column.name === 'stock_quantity')) {
      await sqliteRun('ALTER TABLE menu_items ADD COLUMN stock_quantity INTEGER NOT NULL DEFAULT 0');
    }
    await sqliteRun(`
      CREATE TABLE IF NOT EXISTS stock_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        menu_item_id INTEGER NOT NULL,
        quantity_change INTEGER NOT NULL,
        type TEXT NOT NULL,
        order_id INTEGER,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } else {
    const [rows] = await pool.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'menu_items'`,
      [dbConfig.database]
    );
    if (!rows.some((column) => column.COLUMN_NAME === 'stock_quantity')) {
      await pool.query('ALTER TABLE menu_items ADD COLUMN stock_quantity INT NOT NULL DEFAULT 0');
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stock_movements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        menu_item_id INT NOT NULL,
        quantity_change INT NOT NULL,
        type VARCHAR(16) NOT NULL,
        order_id INT NULL,
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_stock_movements_item_created (menu_item_id, created_at),
        INDEX idx_stock_movements_order (order_id)
      )
    `);
  }

  if (postgresPool) {
    await postgresPool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS age INTEGER');
    await postgresPool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255)');
    await postgresPool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_whatsapp VARCHAR(20)');
    await postgresPool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0');
    await postgresPool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS weight DECIMAL(5,2)');
    await postgresPool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS height DECIMAL(5,2)');
    await postgresPool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance_cents BIGINT NOT NULL DEFAULT 0');
  } else if (sqliteDb) {
    const columns = await sqliteAll('PRAGMA table_info(users)');
    const existingColumns = new Set(columns.map((column) => column.name));
    const columnDefinitions = [
      { name: 'age', sql: 'ALTER TABLE users ADD COLUMN age INTEGER' },
      { name: 'email', sql: 'ALTER TABLE users ADD COLUMN email TEXT' },
      { name: 'recovery_whatsapp', sql: 'ALTER TABLE users ADD COLUMN recovery_whatsapp TEXT' },
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
      { name: 'email', sql: 'ALTER TABLE users ADD COLUMN email VARCHAR(255)' },
      { name: 'recovery_whatsapp', sql: 'ALTER TABLE users ADD COLUMN recovery_whatsapp VARCHAR(20)' },
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

  if (postgresPool) {
    await postgresPool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users (email) WHERE email IS NOT NULL'
    );
    await postgresPool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL UNIQUE,
        expires_at_ms BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await postgresPool.query(
      'CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens (user_id)'
    );
  } else if (sqliteDb) {
    await sqliteRun(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users (email) WHERE email IS NOT NULL'
    );
    await sqliteRun(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at_ms INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await sqliteRun(
      'CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens (user_id)'
    );
  } else {
    const [indexes] = await pool.query(
      `SELECT INDEX_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_users_email_unique'`,
      [dbConfig.database]
    );
    if (!indexes.length) {
      await pool.query('CREATE UNIQUE INDEX idx_users_email_unique ON users (email)');
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        token_hash CHAR(64) NOT NULL UNIQUE,
        expires_at_ms BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_password_reset_tokens_user (user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  }

  if (postgresPool) {
    await postgresPool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id BIGINT');
    await postgresPool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(16) NOT NULL DEFAULT 'cash'");
  } else if (sqliteDb) {
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

  if (postgresPool) {
    await postgresPool.query(`
      CREATE TABLE IF NOT EXISTS diet_profiles (
        user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        goal VARCHAR(32) NOT NULL DEFAULT 'balanced',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await postgresPool.query(`
      CREATE TABLE IF NOT EXISTS diet_meal_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        menu_item_id BIGINT NOT NULL,
        food_name VARCHAR(255) NOT NULL,
        servings DECIMAL(4,1) NOT NULL,
        calories DECIMAL(8,1) NOT NULL,
        protein DECIMAL(8,1) NOT NULL,
        carbohydrates DECIMAL(8,1) NOT NULL,
        fat DECIMAL(8,1) NOT NULL,
        fiber DECIMAL(8,1) NOT NULL,
        eaten_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await postgresPool.query(`
      CREATE TABLE IF NOT EXISTS diet_feedback (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        menu_item_id BIGINT NOT NULL,
        rating SMALLINT NOT NULL,
        calories DECIMAL(8,1) NOT NULL,
        protein DECIMAL(8,1) NOT NULL,
        carbohydrates DECIMAL(8,1) NOT NULL,
        fat DECIMAL(8,1) NOT NULL,
        fiber DECIMAL(8,1) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_diet_meal_logs_user_date ON diet_meal_logs (user_id, eaten_at)');
    await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_diet_feedback_user_item ON diet_feedback (user_id, menu_item_id)');
  } else if (sqliteDb) {
    await sqliteRun(`
      CREATE TABLE IF NOT EXISTS diet_profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        goal TEXT NOT NULL DEFAULT 'balanced',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await sqliteRun(`
      CREATE TABLE IF NOT EXISTS diet_meal_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        menu_item_id INTEGER NOT NULL,
        food_name TEXT NOT NULL,
        servings DECIMAL(4,1) NOT NULL,
        calories DECIMAL(8,1) NOT NULL,
        protein DECIMAL(8,1) NOT NULL,
        carbohydrates DECIMAL(8,1) NOT NULL,
        fat DECIMAL(8,1) NOT NULL,
        fiber DECIMAL(8,1) NOT NULL,
        eaten_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await sqliteRun(`
      CREATE TABLE IF NOT EXISTS diet_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        menu_item_id INTEGER NOT NULL,
        rating INTEGER NOT NULL,
        calories DECIMAL(8,1) NOT NULL,
        protein DECIMAL(8,1) NOT NULL,
        carbohydrates DECIMAL(8,1) NOT NULL,
        fat DECIMAL(8,1) NOT NULL,
        fiber DECIMAL(8,1) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await sqliteRun('CREATE INDEX IF NOT EXISTS idx_diet_meal_logs_user_date ON diet_meal_logs (user_id, eaten_at)');
    await sqliteRun('CREATE INDEX IF NOT EXISTS idx_diet_feedback_user_item ON diet_feedback (user_id, menu_item_id)');
  } else {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS diet_profiles (
        user_id INT PRIMARY KEY,
        goal VARCHAR(32) NOT NULL DEFAULT 'balanced',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS diet_meal_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        menu_item_id INT NOT NULL,
        food_name VARCHAR(255) NOT NULL,
        servings DECIMAL(4,1) NOT NULL,
        calories DECIMAL(8,1) NOT NULL,
        protein DECIMAL(8,1) NOT NULL,
        carbohydrates DECIMAL(8,1) NOT NULL,
        fat DECIMAL(8,1) NOT NULL,
        fiber DECIMAL(8,1) NOT NULL,
        eaten_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_diet_meal_logs_user_date (user_id, eaten_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS diet_feedback (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        menu_item_id INT NOT NULL,
        rating SMALLINT NOT NULL,
        calories DECIMAL(8,1) NOT NULL,
        protein DECIMAL(8,1) NOT NULL,
        carbohydrates DECIMAL(8,1) NOT NULL,
        fat DECIMAL(8,1) NOT NULL,
        fiber DECIMAL(8,1) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_diet_feedback_user_item (user_id, menu_item_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  }

  if (postgresPool) {
    await postgresPool.query(`
      CREATE TABLE IF NOT EXISTS client_feedback (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category VARCHAR(32) NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'new',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_client_feedback_created ON client_feedback (status, created_at)');
  } else if (sqliteDb) {
    await sqliteRun(`
      CREATE TABLE IF NOT EXISTS client_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await sqliteRun('CREATE INDEX IF NOT EXISTS idx_client_feedback_created ON client_feedback (status, created_at)');
  } else {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS client_feedback (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        category VARCHAR(32) NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'new',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_client_feedback_created (status, created_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  }

  if (requireEmpty) {
    const tables = [
      'menu_items',
      'menu_schedule',
      'orders',
      'order_items',
      'users',
      'stock_movements',
      'account_transactions',
      'password_reset_tokens',
      'diet_profiles',
      'diet_meal_logs',
      'diet_feedback',
      'client_feedback'
    ];
    for (const table of tables) {
      const rows = await all(`SELECT COUNT(*) AS count FROM ${table}`);
      if (Number(rows[0].count) !== 0) {
        throw new Error(`Neon table "${table}" is not empty. Migration stopped without importing data.`);
      }
    }
  }

  if (!seedData) return;

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
        ('Beef Burger', 'Juicy grilled beef patty with lettuce, tomato and cheese.', 1.50, 'Burgers', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80'),
        ('Chicken Wrap', 'Crispy chicken, slaw, and spicy mayo in a soft wrap.', 2.00, 'Wraps', 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=900&q=80'),
        ('Rice & Stew', 'Traditional savory stew served with fluffy rice.', 2.00, 'Meals', 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=900&q=80'),
        ('Noodles Special', 'Stir-fried noodles with vegetables and choice of protein.', 2.00, 'Noodles', 'https://images.unsplash.com/photo-1516100882582-96c3a05fe590?auto=format&fit=crop&w=900&q=80'),
        ('Chips & Chicken', 'Crispy fries with seasoned chicken pieces and dip.', 2.00, 'Sides', 'https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=900&q=80'),
        ('Fruit Smoothie', 'Refreshing fruit blend with yogurt and ice.', 8.50, 'Drink', 'https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=900&q=80')
    `);
  }

  await run("UPDATE menu_items SET category = 'Drink' WHERE category = 'Drinks'");
  await run(
    'UPDATE menu_items SET price = ? WHERE name IN (?, ?, ?)',
    [2.00, 'Chicken Wrap', 'Noodles Special', 'Chips & Chicken']
  );
  await run('UPDATE menu_items SET price = ? WHERE name = ?', [2.00, 'Rice & Stew']);

  const beefBurger = await get('SELECT id, image FROM menu_items WHERE name = ? LIMIT 1', ['Beef Burger']);
  if (beefBurger) {
    await run('UPDATE menu_items SET price = ? WHERE id = ?', [1.50, beefBurger.id]);

    let burgerAndChips = await get('SELECT id FROM menu_items WHERE name = ? LIMIT 1', ['Beef Burger & Chips']);
    if (burgerAndChips) {
      await run('UPDATE menu_items SET price = ? WHERE id = ?', [2.00, burgerAndChips.id]);
    } else {
      const result = await run(
        'INSERT INTO menu_items (name, description, price, category, image) VALUES (?, ?, ?, ?, ?)',
        ['Beef Burger & Chips', 'Juicy grilled beef burger served with chips.', 2.00, 'Burgers', beefBurger.image]
      );
      burgerAndChips = { id: result.id };
    }

    const burgerDays = await all(
      'SELECT day_of_week FROM menu_schedule WHERE menu_item_id = ?',
      [beefBurger.id]
    );
    for (const { day_of_week: dayOfWeek } of burgerDays) {
      const scheduled = await get(
        'SELECT menu_item_id FROM menu_schedule WHERE day_of_week = ? AND menu_item_id = ?',
        [dayOfWeek, burgerAndChips.id]
      );
      if (!scheduled) {
        await run(
          'INSERT INTO menu_schedule (day_of_week, menu_item_id) VALUES (?, ?)',
          [dayOfWeek, burgerAndChips.id]
        );
      }
    }
  }

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
      [name, description, price, 'Drink', '/drinks-assortment.jpg']
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
  if (postgresPool) {
    await withTransaction(async (transaction) => {
      await transaction.run('DELETE FROM menu_schedule');
      for (const entry of entries) {
        await transaction.run(
          'INSERT INTO menu_schedule (day_of_week, menu_item_id) VALUES (?, ?)',
          [entry.dayOfWeek, entry.menuItemId]
        );
      }
    });
    return;
  }

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

async function closeDatabase() {
  if (postgresPool) await postgresPool.end();
  if (pool) await pool.end();
  if (sqliteDb) {
    await new Promise((resolve, reject) => {
      sqliteDb.close((error) => error ? reject(error) : resolve());
    });
  }
}

module.exports = {
  pool,
  run,
  get,
  all,
  withTransaction,
  initializeDatabase,
  replaceMenuSchedule,
  closeDatabase
};