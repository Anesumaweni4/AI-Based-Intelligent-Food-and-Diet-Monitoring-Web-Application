// Nutrition estimates for menu items and common foods eaten outside THE KITCHEN.
//
// Each menu item is broken into the parts named in it ("Rice and chicken stew"
// = a portion of rice + a portion of chicken stew) and the parts are added up.
// Values per typical student portion are rounded from standard food composition
// tables (USDA FoodData Central and the FAO/WHO food composition references)
// and are estimates, not lab measurements.
//
// Order: [calories kcal, protein g, carbohydrates g, fat g, fibre g, sugar g]

const COMPONENTS = [
  // Ready-made dishes (checked first so their words are not split up)
  { key: 'chicken wrap', label: 'chicken wrap', match: /chicken wrap/, values: [520, 30, 48, 22, 5, 4] },
  { key: 'cheeseburger', label: 'cheeseburger', match: /cheese ?burger/, values: [540, 28, 41, 29, 2.5, 7.5] },
  { key: 'burger', label: 'beef burger', match: /(?:beef )?burger/, values: [480, 25, 40, 24, 2.5, 7] },
  { key: 'hotdog', label: 'hotdog', match: /hot ?dog/, values: [290, 10, 26, 16, 1.5, 4] },
  { key: 'quarter chicken', label: 'quarter chicken', match: /quarter chicken/, values: [400, 35, 2, 28, 0, 0.5] },
  { key: 'chicken curry', label: 'chicken curry', match: /chicken curry/, values: [330, 27, 9, 20, 2, 3] },
  { key: 'chicken stirfry', label: 'chicken stir-fry', match: /chicken stir ?fry/, values: [280, 26, 12, 14, 2.5, 5] },
  { key: 'chicken stew', label: 'chicken stew', match: /chicken stew/, values: [300, 28, 6, 18, 1, 2] },
  { key: 'offals', label: 'offals', match: /(?:chicken )?offals?/, values: [260, 25, 3, 16, 0, 0.5] },
  { key: 'chicken', label: 'chicken', match: /chicken/, values: [320, 30, 4, 20, 0.5, 1] },
  { key: 'beef bones', label: 'beef bones', match: /beef bones/, values: [300, 20, 3, 23, 0.5, 1] },
  { key: 'pork bones', label: 'pork bones', match: /pork bones/, values: [320, 18, 3, 26, 0.5, 1] },
  { key: 'pork trotters', label: 'pork trotters', match: /pork trotters|trotters/, values: [290, 20, 2, 22, 0, 0.5] },
  { key: 't-bone', label: 'T-bone steak', match: /t-? ?bone/, values: [430, 38, 0, 30, 0, 0] },
  { key: 'meatballs', label: 'meatballs', match: /meatballs?/, values: [330, 20, 12, 22, 1, 4] },
  { key: 'mince', label: 'mince', match: /mince/, values: [300, 23, 6, 20, 1.5, 3] },
  { key: 'guru', label: 'guru (tripe)', match: /guru|tripe/, values: [220, 21, 3, 13, 0, 0] },
  { key: 'boerewors', label: 'boerewors', match: /boerewors/, values: [330, 15, 3, 29, 0, 1] },
  { key: 'russian', label: 'russian sausage', match: /russian/, values: [300, 11, 4, 27, 0, 1] },
  { key: 'fish', label: 'fish', match: /fish/, values: [320, 30, 8, 18, 0.5, 0.5] },
  { key: 'haifiridzi', label: 'haifiridzi', match: /haifiridzi/, values: [220, 30, 2, 10, 0, 0] },
  { key: 'stirfry', label: 'beef & vegetable stir-fry', match: /stir ?fry/, values: [290, 22, 14, 16, 3.5, 6] },
  { key: 'pork', label: 'pork', match: /pork/, values: [330, 24, 4, 24, 0.5, 1] },
  { key: 'beef', label: 'beef stew', match: /beef|\bstew\b/, values: [280, 26, 5, 17, 1, 2] },
  { key: 'beans', label: 'beans', match: /beans/, values: [230, 14, 38, 2, 12, 4] },
  { key: 'cheese', label: 'cheese', match: /cheese/, values: [160, 10, 0.5, 13, 0, 0.2] },
  // Vegetables
  { key: 'coleslaw', label: 'coleslaw', match: /coleslaw/, values: [150, 1.2, 12, 11, 2.5, 9] },
  { key: 'salad', label: 'salad', match: /salad/, values: [80, 2, 8, 4.5, 3, 4] },
  { key: 'vegetables', label: 'vegetables', match: /vegetables?|\bveg\b|covo|rape/, values: [90, 3, 9, 5, 4, 2] },
  // Starches
  { key: 'rice dovi', label: 'rice with peanut butter (dovi)', match: /rice dovi/, values: [450, 11, 74, 13, 3, 2] },
  { key: 'rice', label: 'rice', match: /rice/, values: [325, 6.5, 70, 0.7, 1, 0.1] },
  { key: 'sadza', label: 'sadza', match: /sadza/, values: [330, 7, 72, 1.5, 4.5, 0.5] },
  { key: 'chips', label: 'chips', match: /chips+/, values: [470, 5.5, 60, 23, 5.5, 0.5] },
  { key: 'wedges', label: 'potato wedges', match: /wedges/, values: [350, 5, 52, 14, 5, 1] },
  { key: 'pasta', label: 'pasta', match: /spaghetti|pasta/, values: [350, 12, 70, 2, 4, 1.5] },
  { key: 'noodles', label: 'noodles', match: /noodles/, values: [380, 9, 54, 14, 2.5, 1.5] },
  { key: 'roll', label: 'bread roll', match: /\broll\b/, values: [160, 5, 29, 2.5, 1.5, 3] },
  // Treats
  { key: 'cake', label: 'cake', match: /cake/, values: [350, 4, 50, 15, 1, 32] }
];

const DRINKS = [
  { key: 'water', label: 'water', match: /water/, values: [0, 0, 0, 0, 0, 0] },
  { key: 'smoothie', label: 'fruit smoothie', match: /smoothie/, values: [230, 6, 45, 3, 4, 33] },
  {
    key: 'juice',
    label: 'fruit juice drink',
    match: /minute maid|fru(?:it|t)i?cana|fruta|sippy|juice|revive|fresh ?up|maheu/,
    values: [170, 0.5, 41, 0, 0.3, 38]
  },
  { key: 'soft drink', label: 'soft drink', match: /./, values: [210, 0, 53, 0, 0, 53] }
];

const CATEGORY_FALLBACK = [
  { match: /drink/, key: 'drink', label: 'drink', values: [170, 0.5, 41, 0, 0.3, 38], isDrink: true },
  { match: /burger/, key: 'burger', label: 'burger meal', values: [550, 27, 50, 26, 5, 7] },
  { match: /wrap/, key: 'wrap', label: 'wrap', values: [500, 26, 48, 20, 5, 4] },
  { match: /noodle/, key: 'noodles', label: 'noodles', values: [560, 22, 78, 18, 7, 3] },
  { match: /side/, key: 'side', label: 'side dish', values: [420, 12, 48, 20, 5, 2] },
  { match: /./, key: 'meal', label: 'plated meal', values: [600, 24, 78, 20, 7, 4] }
];

// Foods students often eat in their accommodation or buy elsewhere.
const OUTSIDE_FOODS = [
  { key: 'bread-margarine', name: 'Bread, 2 slices with margarine', values: [230, 6, 30, 9, 2, 3] },
  { key: 'peanut-butter-sandwich', name: 'Peanut butter sandwich', values: [350, 12, 34, 18, 4, 6] },
  { key: 'tea-sugar', name: 'Tea with milk and 2 sugars', values: [60, 1, 11, 1, 0, 10], isDrink: true },
  { key: 'porridge', name: 'Maize porridge (bota), 1 bowl', values: [180, 4, 38, 1, 2, 6] },
  { key: 'eggs', name: 'Eggs, 2 boiled or fried', values: [170, 13, 1, 12, 0, 1] },
  { key: 'banana', name: 'Banana', values: [105, 1.3, 27, 0.4, 3.1, 14] },
  { key: 'apple-orange', name: 'Apple or orange', values: [80, 0.5, 20, 0.2, 3.5, 15] },
  { key: 'instant-noodles', name: 'Instant noodles, 1 pack', values: [380, 8, 52, 15, 2, 2] },
  { key: 'home-sadza-veg', name: 'Home-cooked sadza with vegetables', values: [420, 10, 81, 6, 9, 3] },
  { key: 'home-rice-beans', name: 'Home-cooked rice and beans', values: [480, 17, 92, 4, 11, 3] },
  { key: 'milk', name: 'Milk, 1 glass (250 ml)', values: [150, 8, 12, 8, 0, 12], isDrink: true },
  { key: 'maheu', name: 'Maheu, 500 ml', values: [250, 4, 52, 2, 1, 22], isDrink: true },
  { key: 'yoghurt', name: 'Yoghurt, 1 cup', values: [150, 6, 22, 4, 0, 18] },
  { key: 'maputi', name: 'Maputi (puffed maize), 1 cup', values: [110, 3, 23, 1, 2, 0] },
  { key: 'biscuits', name: 'Biscuits, 4', values: [200, 2.5, 28, 9, 1, 11] },
  { key: 'crisps', name: 'Crisps, small packet', values: [160, 2, 15, 10, 1, 0.5] },
  { key: 'fat-cakes', name: 'Fat cakes (magwinya), 2', values: [360, 6, 44, 18, 2, 6] },
  { key: 'soft-drink-outside', name: 'Soft drink, 500 ml', values: [210, 0, 53, 0, 0, 53], isDrink: true }
];

function toNutrition(values, extra = {}) {
  const [calories, protein, carbohydrates, fat, fiber, sugar] = values.map((value) => Math.round(value * 10) / 10);
  return { calories, protein, carbohydrates, fat, fiber, sugar, ...extra };
}

function getNutrition(item) {
  const rawName = String(item.name || '').toLowerCase();
  const category = String(item.category || '').toLowerCase();
  const isSmallPortion = /\$\s*1(?:\.00)?\b/.test(rawName) && !/drink/.test(category);
  const name = rawName.replace(/\$\s*\d+(?:\.\d+)?/g, ' ').replace(/[&+,-]/g, ' ').replace(/\s+/g, ' ').trim();

  if (/drink/.test(category)) {
    const drink = DRINKS.find((entry) => entry.match.test(name));
    const sizeFactor = /350\s*ml/.test(name) ? 0.7 : 1;
    return toNutrition(drink.values.map((value) => value * sizeFactor), {
      isDrink: true,
      components: [drink.label],
      estimateType: 'component estimate'
    });
  }

  let remaining = ` ${name} `;
  const parts = [];
  for (const component of COMPONENTS) {
    if (component.match.test(remaining)) {
      parts.push(component);
      remaining = remaining.replace(component.match, ' ');
    }
  }

  if (!parts.length) {
    const fallback = CATEGORY_FALLBACK.find((entry) => entry.match.test(category));
    return toNutrition(fallback.values, {
      isDrink: Boolean(fallback.isDrink),
      components: [fallback.label],
      estimateType: 'category estimate'
    });
  }

  const factor = isSmallPortion ? 0.7 : 1;
  const totals = [0, 0, 0, 0, 0, 0];
  for (const part of parts) {
    part.values.forEach((value, index) => { totals[index] += value * factor; });
  }
  return toNutrition(totals, {
    isDrink: false,
    components: parts.map((part) => part.label),
    estimateType: 'component estimate'
  });
}

function getOutsideFood(key) {
  const food = OUTSIDE_FOODS.find((entry) => entry.key === key);
  if (!food) return null;
  return {
    key: food.key,
    name: food.name,
    ...toNutrition(food.values, { isDrink: Boolean(food.isDrink), components: [food.name], estimateType: 'standard portion' })
  };
}

function listOutsideFoods() {
  return OUTSIDE_FOODS.map((food) => getOutsideFood(food.key));
}

module.exports = { getNutrition, getOutsideFood, listOutsideFoods };
