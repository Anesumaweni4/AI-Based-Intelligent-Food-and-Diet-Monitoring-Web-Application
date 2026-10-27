const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { Client } = require('pg');

const sourcePath = path.resolve(
  process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'data', 'food-ordering-app.db')
);
const applyChanges = process.argv.includes('--apply');

function openSqliteReadOnly(filePath) {
  return new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (error) => {
      if (error) reject(error);
      else resolve(connection);
    });
  });
}

function sqliteAll(connection, sql) {
  return new Promise((resolve, reject) => {
    connection.all(sql, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function closeSqlite(connection) {
  return new Promise((resolve, reject) => {
    connection.close((error) => error ? reject(error) : resolve());
  });
}

function normalizeName(name) {
  return name.trim().toLowerCase();
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Set DATABASE_URL to your Neon PostgreSQL connection string before syncing stock.');
  }

  let source;
  let client;
  let transactionStarted = false;
  try {
    source = await openSqliteReadOnly(sourcePath);
    const sourceItems = await sqliteAll(
      source,
      'SELECT id, name, stock_quantity FROM menu_items ORDER BY id'
    );
    if (sourceItems.length === 0) {
      throw new Error(`No menu items were found in the SQLite source: ${sourcePath}`);
    }

    const sourceNames = new Set();
    for (const item of sourceItems) {
      if (typeof item.name !== 'string' || !item.name.trim()) {
        throw new Error(`SQLite menu item ${item.id} has no valid name.`);
      }
      if (!Number.isSafeInteger(item.stock_quantity) || item.stock_quantity < 0) {
        throw new Error(`SQLite stock quantity for "${item.name}" must be a nonnegative whole number.`);
      }
      const name = normalizeName(item.name);
      if (sourceNames.has(name)) {
        throw new Error(`SQLite has more than one menu item named "${item.name}".`);
      }
      sourceNames.add(name);
    }

    client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: true }
    });
    await client.connect();
    await client.query('BEGIN');
    transactionStarted = true;

    const targetResult = await client.query(
      'SELECT id, name, stock_quantity FROM menu_items ORDER BY id FOR UPDATE'
    );
    const targetByName = new Map();
    for (const item of targetResult.rows) {
      const name = normalizeName(item.name);
      if (targetByName.has(name)) {
        throw new Error(`Neon has more than one menu item named "${item.name}"; no stock was changed.`);
      }
      targetByName.set(name, item);
    }

    const missingItems = sourceItems.filter((item) => !targetByName.has(normalizeName(item.name)));
    if (missingItems.length) {
      throw new Error(
        `These SQLite menu items are missing from Neon: ${missingItems.map(({ name }) => name).join(', ')}. No stock was changed.`
      );
    }

    const updates = sourceItems.map((item) => ({
      source: item,
      target: targetByName.get(normalizeName(item.name))
    }));
    for (const { source: sourceItem, target } of updates) {
      console.log(`${sourceItem.name}: Neon ${Number(target.stock_quantity)} -> SQLite ${sourceItem.stock_quantity}`);
      if (applyChanges) {
        const result = await client.query(
          'UPDATE menu_items SET stock_quantity = $1 WHERE id = $2 RETURNING stock_quantity',
          [sourceItem.stock_quantity, target.id]
        );
        if (result.rowCount !== 1 || Number(result.rows[0].stock_quantity) !== sourceItem.stock_quantity) {
          throw new Error(`Stock verification failed for "${sourceItem.name}".`);
        }
      }
    }

    if (applyChanges) {
      await client.query('COMMIT');
      transactionStarted = false;
      console.log(`Stock sync complete for ${updates.length} menu items. Neon orders and accounts were not changed.`);
    } else {
      await client.query('ROLLBACK');
      transactionStarted = false;
      console.log(`Preview only: ${updates.length} menu items matched. Re-run with -- --apply to update Neon stock.`);
    }
  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query('ROLLBACK');
        transactionStarted = false;
      } catch (rollbackError) {
        console.error(`Stock sync rollback failed: ${rollbackError.message}`);
      }
    }
    throw error;
  } finally {
    try {
      if (source) await closeSqlite(source);
    } finally {
      if (client) await client.end();
    }
  }
}

main().catch((error) => {
  console.error('Neon stock sync failed:', error.message);
  process.exitCode = 1;
});
