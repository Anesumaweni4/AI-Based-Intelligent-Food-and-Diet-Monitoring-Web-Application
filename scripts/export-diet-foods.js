// Writes ml/data/foods.json: every menu item and common outside food with its
// nutrition estimate. The Python simulator uses this so the training data is
// built from the same foods and values the live app uses.
//   npm run ml:export-foods
const fs = require('fs');
const path = require('path');
const { initializeDatabase, all, closeDatabase } = require('../db');
const { getNutrition, listOutsideFoods } = require('../nutrition');

async function main() {
  await initializeDatabase({ seedData: false });
  const menuItems = await all('SELECT id, name, category FROM menu_items ORDER BY id');
  const foods = [
    ...menuItems.map((item) => {
      const nutrition = getNutrition(item);
      return {
        source: 'menu',
        id: Number(item.id),
        name: item.name,
        category: item.category,
        ...nutrition
      };
    }),
    ...listOutsideFoods().map((food) => ({ source: 'outside', id: food.key, category: food.isDrink ? 'Drink' : 'Home food', ...food }))
  ];

  const outFile = path.join(__dirname, '..', 'ml', 'data', 'foods.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify({ exportedAt: new Date().toISOString(), foods }, null, 2)}\n`);
  console.log(`Wrote ${foods.length} foods to ${path.relative(process.cwd(), outFile)}`);
  if (typeof closeDatabase === 'function') await closeDatabase();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
