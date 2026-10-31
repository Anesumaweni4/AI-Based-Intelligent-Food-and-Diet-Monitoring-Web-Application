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
    throw new Error('Set DATABASE_URL to your Neon PostgreSQL connection string before syncing ingredient inventory.');
  }

  let source;
  let client;
  let transactionStarted = false;
  try {
    source = await openSqliteReadOnly(sourcePath);
    const sourceItems = await sqliteAll(
      source,
      'SELECT id, name, unit, current_quantity FROM inventory_items ORDER BY id'
    );
    if (sourceItems.length === 0) {
      throw new Error(`No ingredient inventory items were found in the SQLite source: ${sourcePath}`);
    }

    const sourceNames = new Set();
    for (const item of sourceItems) {
      if (typeof item.name !== 'string' || !item.name.trim()) {
        throw new Error(`SQLite inventory item ${item.id} has no valid name.`);
      }
      const quantity = Number(item.current_quantity);
      if (!item.unit || !Number.isFinite(quantity) || quantity < 0 ||
          quantity > 999999999.999 || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-7) {
        throw new Error(`SQLite inventory quantity for "${item.name}" must be nonnegative and use at most three decimal places.`);
      }
      const name = normalizeName(item.name);
      if (sourceNames.has(name)) {
        throw new Error(`SQLite has more than one inventory item named "${item.name}".`);
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
      'SELECT id, name, unit, current_quantity FROM inventory_items ORDER BY id FOR UPDATE'
    );
    const targetByName = new Map();
    for (const item of targetResult.rows) {
      const name = normalizeName(item.name);
      if (targetByName.has(name)) {
        throw new Error(`Neon has more than one inventory item named "${item.name}"; no stock was changed.`);
      }
      targetByName.set(name, item);
    }

    const missingItems = sourceItems.filter((item) => !targetByName.has(normalizeName(item.name)));
    if (missingItems.length) {
      throw new Error(
        `These SQLite inventory items are missing from Neon: ${missingItems.map(({ name }) => name).join(', ')}. No stock was changed.`
      );
    }

    const updates = sourceItems.map((item) => ({
      source: item,
      target: targetByName.get(normalizeName(item.name))
    }));
    for (const { source: sourceItem, target } of updates) {
      if (target.unit !== sourceItem.unit) {
        throw new Error(`Inventory unit mismatch for "${sourceItem.name}": SQLite uses ${sourceItem.unit}, Neon uses ${target.unit}. No stock was changed.`);
      }
      const quantity = Number(sourceItem.current_quantity);
      console.log(`${sourceItem.name} (${sourceItem.unit}): Neon ${Number(target.current_quantity)} -> SQLite ${quantity}`);
      if (applyChanges) {
        const result = await client.query(
          'UPDATE inventory_items SET current_quantity = $1 WHERE id = $2 RETURNING current_quantity',
          [quantity, target.id]
        );
        if (result.rowCount !== 1 || Number(result.rows[0].current_quantity) !== quantity) {
          throw new Error(`Inventory verification failed for "${sourceItem.name}".`);
        }
      }
    }

    if (applyChanges) {
      await client.query('COMMIT');
      transactionStarted = false;
      console.log(`Ingredient inventory sync complete for ${updates.length} items. Menu items, orders, and accounts were not changed.`);
    } else {
      await client.query('ROLLBACK');
      transactionStarted = false;
      console.log(`Preview only: ${updates.length} ingredient items matched. Re-run with -- --apply to update Neon inventory.`);
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
  console.error('Neon ingredient inventory sync failed:', error.message);
  process.exitCode = 1;
});
