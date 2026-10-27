const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const db = require('../db');

const sourcePath = path.resolve(
  process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'data', 'food-ordering-app.db')
);
const tableOrder = [
  'menu_items',
  'users',
  'orders',
  'menu_schedule',
  'order_items',
  'monthly_invoices',
  'monthly_invoice_orders',
  'stock_movements',
  'account_transactions',
  'diet_profiles',
  'diet_meal_logs',
  'diet_feedback',
  'client_feedback',
  'password_reset_tokens'
];
const requiredTables = ['menu_items', 'orders', 'order_items', 'users'];
const tablesWithIdentity = new Set([
  'menu_items',
  'users',
  'orders',
  'order_items',
  'monthly_invoices',
  'stock_movements',
  'account_transactions',
  'diet_meal_logs',
  'diet_feedback',
  'client_feedback',
  'password_reset_tokens'
]);

function sqliteAll(connection, sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function sqliteExec(connection, sql) {
  return new Promise((resolve, reject) => {
    connection.exec(sql, (error) => error ? reject(error) : resolve());
  });
}

function openSqliteReadOnly(filePath) {
  return new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (error) => {
      if (error) reject(error);
      else resolve(connection);
    });
  });
}

function closeSqlite(connection) {
  return new Promise((resolve, reject) => {
    connection.close((error) => error ? reject(error) : resolve());
  });
}

async function readSqliteSnapshot(connection) {
  await sqliteExec(connection, 'BEGIN');
  try {
    const listedTables = await sqliteAll(
      connection,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    );
    const availableTables = new Set(listedTables.map(({ name }) => name));
    const missingRequired = requiredTables.filter((table) => !availableTables.has(table));
    if (missingRequired.length) {
      throw new Error(`SQLite source is missing required tables: ${missingRequired.join(', ')}`);
    }

    const snapshot = new Map();
    for (const table of tableOrder) {
      if (!availableTables.has(table)) continue;
      const columns = await sqliteAll(connection, `PRAGMA table_info("${table}")`);
      const orderBy = columns.some(({ name }) => name === 'id')
        ? 'id'
        : table === 'menu_schedule'
          ? 'day_of_week, menu_item_id'
          : null;
      const sql = `SELECT * FROM "${table}"${orderBy ? ` ORDER BY ${orderBy}` : ''}`;
      snapshot.set(table, {
        columns: columns.map(({ name }) => name),
        rows: await sqliteAll(connection, sql)
      });
    }
    await sqliteExec(connection, 'COMMIT');
    return snapshot;
  } catch (error) {
    await sqliteExec(connection, 'ROLLBACK');
    throw error;
  }
}

async function migrateTable(transaction, table, sourceTable) {
  const targetColumns = await transaction.all(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = ?`,
    [table]
  );
  const targetColumnNames = new Set(targetColumns.map(({ column_name: name }) => name));
  const unsupportedColumns = sourceTable.columns.filter((column) => !targetColumnNames.has(column));
  if (unsupportedColumns.length) {
    throw new Error(`Cannot safely migrate ${table}; Neon is missing columns: ${unsupportedColumns.join(', ')}`);
  }
  if (sourceTable.rows.length === 0) return 0;

  const columns = sourceTable.columns;
  const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  const insertSql = `INSERT INTO "${table}" (${quotedColumns}) VALUES (${placeholders})`;
  for (const row of sourceTable.rows) {
    await transaction.run(insertSql, columns.map((column) => row[column]));
  }

  if (tablesWithIdentity.has(table)) {
    await transaction.run(
      `SELECT setval(
         pg_get_serial_sequence('public.${table}', 'id'),
         COALESCE(MAX(id), 1),
         COUNT(*) > 0
       ) FROM "${table}"`
    );
  }
  return sourceTable.rows.length;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Set DATABASE_URL to your Neon PostgreSQL connection string before running this migration.');
  }

  let source;
  try {
    source = await openSqliteReadOnly(sourcePath);
    const snapshot = await readSqliteSnapshot(source);
    const counts = Object.fromEntries(
      [...snapshot].map(([table, data]) => [table, data.rows.length])
    );
    console.log(`SQLite source: ${sourcePath}`);
    console.log('Source row counts:', JSON.stringify(counts));

    await db.initializeDatabase({ seedData: false, requireEmpty: true });
    const migratedCounts = await db.withTransaction(async (transaction) => {
      const result = {};
      for (const table of tableOrder) {
        if (!snapshot.has(table)) continue;
        try {
          result[table] = await migrateTable(transaction, table, snapshot.get(table));
        } catch (error) {
          throw new Error(`Failed to migrate ${table}: ${error.message}`);
        }
      }
      for (const table of tableOrder) {
        if (!snapshot.has(table)) continue;
        const target = await transaction.get(`SELECT COUNT(*) AS count FROM ${table}`);
        if (Number(target.count) !== snapshot.get(table).rows.length) {
          throw new Error(`Verification failed for ${table}; expected ${snapshot.get(table).rows.length} rows.`);
        }
      }
      return result;
    });
    console.log('Migration completed and row counts verified:', JSON.stringify(migratedCounts));
  } finally {
    if (source) await closeSqlite(source);
    await db.closeDatabase();
  }
}

main().catch((error) => {
  console.error('SQLite to Neon migration failed:', error.message);
  process.exitCode = 1;
});
