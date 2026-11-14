// Healthy-eating coach: body metrics, hydration, healthy swaps, a full-day
// meal plan, "right now" tips and the weekly report card. Everything here is
// rule-based nutrition guidance built on the targets in diet-model.js.
const { getNutrition, getOutsideFood } = require('./nutrition');
const model = require('./diet-model');

const STARCH_PARTS = new Set(['rice', 'sadza', 'chips', 'potato wedges', 'pasta', 'noodles', 'bread roll', 'rice with peanut butter (dovi)']);
const VEG_PARTS = new Set(['salad', 'vegetables', 'coleslaw', 'beans']);
const SLOT_SHARE = { breakfast: 0.25, lunch: 0.35, supper: 0.3, snack: 0.1 };

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function round(value, places = 0) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Body metrics + hydration
// ---------------------------------------------------------------------------
function bodyMetrics({ age, weight, height }) {
  const kg = Number(weight);
  const cm = Number(height);
  if (!(kg > 0) || !(cm > 0)) return null;
  const metres = cm / 100;
  const bmi = kg / (metres * metres);
  let category = 'healthy';
  let label = 'Healthy weight';
  if (bmi < 18.5) { category = 'under'; label = 'Underweight'; }
  else if (bmi >= 30) { category = 'obese'; label = 'Obesity range'; }
  else if (bmi >= 25) { category = 'over'; label = 'Overweight'; }
  return {
    bmi: round(bmi, 1),
    category,
    label,
    healthyMinKg: round(18.5 * metres * metres, 1),
    healthyMaxKg: round(24.9 * metres * metres, 1),
    under18: Number(age) > 0 && Number(age) < 18,
    note: Number(age) > 0 && Number(age) < 18
      ? 'For under 18s, BMI should be read on age-and-sex growth charts. Use this as a rough guide only.'
      : 'BMI is a rough screening guide and does not measure body fat directly.'
  };
}

function waterTargetMl(sex) {
  return sex === 'male' ? 2500 : sex === 'female' ? 2000 : 2200;
}

// Water drunk, from diary entries (glasses of water and bottled water).
function waterFromLog(log) {
  const name = String(log.food_name || log.foodName || '').toLowerCase();
  const servings = Number(log.servings) || 0;
  if (name.startsWith('glass of water')) return 250 * servings;
  if (/\bwater\b/.test(name)) return 500 * servings;
  return 0;
}

// ---------------------------------------------------------------------------
// How healthy a single food is (0-100), used for swaps and plans
// ---------------------------------------------------------------------------
function healthScore(nutrition) {
  if (nutrition.isDrink) return Math.max(0, Math.min(100, 70 - nutrition.sugar * 1.2));
  const fatPct = nutrition.calories > 0 ? (nutrition.fat * 9) / nutrition.calories : 0;
  const score = 45 + nutrition.protein * 0.6 + nutrition.fiber * 3 - nutrition.sugar * 0.8
    - Math.max(0, fatPct - 0.35) * 150
    - Math.max(0, nutrition.calories - 850) / 12
    - (nutrition.calories < 200 ? 12 : 0);
  return Math.max(0, Math.min(100, score));
}

function mainProtein(components = []) {
  return components.filter((part) => !STARCH_PARTS.has(part) && !VEG_PARTS.has(part));
}

// ---------------------------------------------------------------------------
// Healthy swaps: for less healthy foods eaten this week, a better menu choice
// ---------------------------------------------------------------------------
function healthySwaps(logs, menuItems, limit = 3) {
  const eaten = new Map();
  for (const log of logs) {
    const key = String(log.food_name).toLowerCase();
    if (key.startsWith('glass of water')) continue;
    const entry = eaten.get(key) || {
      name: log.food_name,
      count: 0,
      nutrition: {
        calories: Number(log.calories), protein: Number(log.protein), carbohydrates: Number(log.carbohydrates),
        fat: Number(log.fat), fiber: Number(log.fiber), sugar: Number(log.sugar),
        isDrink: Boolean(Number(log.is_drink)) || log.is_drink === true
      },
      menuItemId: Number(log.menu_item_id) || null
    };
    entry.count += Number(log.servings) || 1;
    eaten.set(key, entry);
  }

  const candidates = menuItems.map((item) => {
    const nutrition = getNutrition(item);
    return { item, nutrition, health: healthScore(nutrition), source: 'menu' };
  });
  // Snacks are swapped for healthy snacks, not full meals.
  const snackCandidates = SNACKS.map((key) => getOutsideFood(key)).map((food) => ({
    // whole fruit gets credit for vitamins and minerals the score cannot see
    item: { id: food.key, name: food.name }, nutrition: food,
    health: healthScore(food) + (['banana', 'apple-orange'].includes(food.key) ? 12 : 0), source: 'outside'
  }));

  const swaps = [];
  for (const food of eaten.values()) {
    const fromNutrition = food.nutrition;
    const menuItem = food.menuItemId ? menuItems.find((item) => Number(item.id) === food.menuItemId) : null;
    const components = menuItem ? getNutrition(menuItem).components : [];
    const fromHealth = healthScore(fromNutrition);
    const fatPct = fromNutrition.calories > 0 ? (fromNutrition.fat * 9) / fromNutrition.calories : 0;
    const flagged = fromNutrition.isDrink
      ? fromNutrition.sugar >= 20
      : fatPct > 0.4 || fromNutrition.sugar >= 25 || fromHealth < 50;
    if (!flagged) continue;

    const proteins = mainProtein(components);
    const isSnack = !fromNutrition.isDrink && fromNutrition.calories < 400;
    let best = null;
    for (const candidate of isSnack ? snackCandidates : candidates) {
      if (candidate.nutrition.isDrink !== fromNutrition.isDrink) continue;
      if (String(candidate.item.name).toLowerCase() === String(food.name).toLowerCase()) continue;
      if (!isSnack && !fromNutrition.isDrink && candidate.nutrition.calories < 300) continue;
      const gain = candidate.health - fromHealth;
      if (gain < 10) continue;
      const shared = mainProtein(candidate.nutrition.components).some((part) => proteins.includes(part));
      const value = gain + (shared ? 25 : 0) - Math.abs(candidate.nutrition.calories - fromNutrition.calories) / 60;
      if (!best || value > best.value) best = { ...candidate, value, shared };
    }
    if (!best) continue;

    const savings = {
      calories: Math.round((fromNutrition.calories - best.nutrition.calories) * food.count),
      sugar: Math.round((fromNutrition.sugar - best.nutrition.sugar) * food.count),
      fat: Math.round((fromNutrition.fat - best.nutrition.fat) * food.count),
      fiber: Math.round((best.nutrition.fiber - fromNutrition.fiber) * food.count)
    };
    let reason;
    if (isSnack) {
      reason = `${Math.round(fromNutrition.sugar - best.nutrition.sugar)} g less sugar, more goodness`;
      if (best.nutrition.sugar >= fromNutrition.sugar) reason = 'Less fat and more fibre';
    } else if (fromNutrition.isDrink) {
      reason = best.nutrition.sugar === 0
        ? `No sugar instead of ${Math.round(fromNutrition.sugar)} g a bottle`
        : `${Math.round(fromNutrition.sugar - best.nutrition.sugar)} g less sugar a bottle`;
    } else if (best.shared) {
      reason = 'Same favourite, healthier side';
    } else {
      reason = `${Math.round(best.nutrition.fiber)} g fibre and less fat`;
    }
    const existing = swaps.find((swap) => swap.to.name === best.item.name);
    if (existing) {
      existing.from.name = `${existing.from.name} & ${food.name}`;
      existing.from.count += food.count;
      for (const key of Object.keys(savings)) existing.savings[key] += savings[key];
      existing.impact += (best.health - fromHealth) * food.count;
      continue;
    }
    swaps.push({
      from: { name: food.name, count: food.count, calories: Math.round(fromNutrition.calories), sugar: round(fromNutrition.sugar, 1), fat: round(fromNutrition.fat, 1) },
      to: { id: best.source === 'menu' ? Number(best.item.id) : best.item.id, source: best.source, name: best.item.name, calories: Math.round(best.nutrition.calories), sugar: round(best.nutrition.sugar, 1), protein: round(best.nutrition.protein, 1), fiber: round(best.nutrition.fiber, 1) },
      savings,
      reason,
      impact: (best.health - fromHealth) * food.count
    });
  }
  swaps.sort((left, right) => right.impact - left.impact);
  return swaps.slice(0, limit).map(({ impact, ...swap }) => swap);
}

// ---------------------------------------------------------------------------
// Full-day meal plan
// ---------------------------------------------------------------------------
const BREAKFAST_MAINS = ['porridge', 'bread-margarine', 'peanut-butter-sandwich', 'eggs'];
const BREAKFAST_EXTRAS = ['eggs', 'banana', 'apple-orange', 'yoghurt', 'milk'];
const SNACKS = ['banana', 'apple-orange', 'yoghurt', 'maputi'];

function sumNutrition(foods) {
  const totals = { calories: 0, protein: 0, carbohydrates: 0, fat: 0, fiber: 0, sugar: 0 };
  for (const food of foods) {
    for (const key of Object.keys(totals)) totals[key] += Number(food[key]) || 0;
  }
  return totals;
}

function slotFit(totals, slotTarget, sugarAllowance) {
  const energyFit = clamp01(1 - Math.abs(totals.calories - slotTarget.calories) / slotTarget.calories);
  const proteinFit = clamp01(totals.protein / slotTarget.protein);
  const fiberFit = clamp01(totals.fiber / slotTarget.fiber);
  const fatPct = totals.calories > 0 ? (totals.fat * 9) / totals.calories : 0;
  const fatFit = fatPct <= 0.35 ? 1 : clamp01(1 - (fatPct - 0.35) / 0.2);
  const sugarPenalty = clamp01(totals.sugar / Math.max(1, sugarAllowance)) * 0.3;
  return energyFit * 0.35 + proteinFit * 0.3 + fiberFit * 0.2 + fatFit * 0.15 - sugarPenalty;
}

function seededPick(options, seed, slotIndex) {
  if (!options.length) return null;
  const top = options.slice(0, Math.min(4, options.length));
  return top[(seed * 7 + slotIndex * 3) % top.length];
}

function asPlanFood(source, food, extra = {}) {
  return {
    source,
    id: source === 'menu' ? Number(food.id) : food.key,
    name: food.name,
    calories: Math.round(food.calories),
    protein: round(food.protein, 1),
    carbohydrates: round(food.carbohydrates, 1),
    fat: round(food.fat, 1),
    fiber: round(food.fiber, 1),
    sugar: round(food.sugar, 1),
    ...extra
  };
}

function mealPlan({ targets, menuItems, peerPopularity = new Map(), seed = 0 }) {
  const slotTargets = Object.fromEntries(Object.entries(SLOT_SHARE).map(([slot, share]) => [slot, {
    calories: targets.calories * share,
    protein: Math.max(5, targets.protein * share),
    fiber: Math.max(2, targets.fiber * share)
  }]));
  const sugarAllowance = (slot) => targets.sugarLimit * SLOT_SHARE[slot];
  const maxPeer = Math.max(1, ...peerPopularity.values());

  // Breakfast from common home foods
  const breakfastOptions = [];
  for (const mainKey of BREAKFAST_MAINS) {
    const main = getOutsideFood(mainKey);
    breakfastOptions.push([main]);
    for (const extraKey of BREAKFAST_EXTRAS) {
      if (extraKey === mainKey) continue;
      const extra = getOutsideFood(extraKey);
      breakfastOptions.push([main, extra]);
      for (const thirdKey of BREAKFAST_EXTRAS) {
        if (thirdKey <= extraKey || thirdKey === mainKey) continue;
        breakfastOptions.push([main, extra, getOutsideFood(thirdKey)]);
      }
    }
  }
  const rankedBreakfast = breakfastOptions
    .map((foods) => ({ foods, fit: slotFit(sumNutrition(foods), slotTargets.breakfast, sugarAllowance('breakfast')) }))
    .sort((left, right) => right.fit - left.fit);
  const breakfast = seededPick(rankedBreakfast, seed, 0);

  // Lunch and supper from THE KITCHEN menu (main + optional vegetable side)
  const menu = menuItems.map((item) => ({ item, nutrition: getNutrition(item) }));
  const mains = menu.filter(({ nutrition }) => !nutrition.isDrink && nutrition.calories >= 350);
  const sides = menu.filter(({ nutrition }) => !nutrition.isDrink && nutrition.components.length === 1 && VEG_PARTS.has(nutrition.components[0]));
  const water = menu.find(({ item, nutrition }) => nutrition.isDrink && nutrition.calories === 0 && /water/i.test(item.name));

  function rankMeals(slot, avoidProteins = []) {
    const options = [];
    for (const main of mains) {
      const proteins = mainProtein(main.nutrition.components);
      const repeat = proteins.some((part) => avoidProteins.includes(part));
      const combos = [[main], ...sides.map((side) => [main, side])];
      for (const combo of combos) {
        const totals = sumNutrition(combo.map((entry) => entry.nutrition));
        const peer = peerPopularity.has(Number(main.item.id)) ? peerPopularity.get(Number(main.item.id)) / maxPeer : 0;
        const fit = slotFit(totals, slotTargets[slot], sugarAllowance(slot)) + peer * 0.05 - (repeat ? 0.15 : 0);
        options.push({ combo, fit, proteins });
      }
    }
    return options.sort((left, right) => right.fit - left.fit);
  }
  const lunch = seededPick(rankMeals('lunch'), seed, 1);
  const supper = seededPick(rankMeals('supper', lunch ? lunch.proteins : []), seed, 2);

  const rankedSnacks = SNACKS.map((key) => getOutsideFood(key))
    .map((food) => ({ foods: [food], fit: slotFit(sumNutrition([food]), slotTargets.snack, sugarAllowance('snack')) }))
    .sort((left, right) => right.fit - left.fit);
  const snack = seededPick(rankedSnacks, seed, 3);

  const slots = [
    { slot: 'breakfast', label: 'Breakfast', where: 'At home', foods: breakfast.foods.map((food) => asPlanFood('outside', food)) },
    {
      slot: 'lunch', label: 'Lunch', where: 'THE KITCHEN',
      foods: [
        ...lunch.combo.map(({ item, nutrition }) => asPlanFood('menu', { ...item, ...nutrition }, { price: Number(item.price) || 0 })),
        ...(water ? [asPlanFood('menu', { ...water.item, ...water.nutrition }, { price: Number(water.item.price) || 0 })] : [])
      ]
    },
    { slot: 'snack', label: 'Snack', where: 'Afternoon', foods: snack.foods.map((food) => asPlanFood('outside', food)) },
    {
      slot: 'supper', label: 'Supper', where: 'THE KITCHEN',
      foods: supper.combo.map(({ item, nutrition }) => asPlanFood('menu', { ...item, ...nutrition }, { price: Number(item.price) || 0 }))
    }
  ].map((slot) => {
    const totals = sumNutrition(slot.foods);
    return { ...slot, totals: { calories: Math.round(totals.calories), protein: round(totals.protein, 1), fiber: round(totals.fiber, 1), sugar: round(totals.sugar, 1) } };
  });

  const dayTotals = sumNutrition(slots.flatMap((slot) => slot.foods));
  const projected = model.scoreDay({
    ...dayTotals,
    meals: 3,
    breakfast: true,
    late: false,
    activeMinutes: targets.activityMinutes
  }, targets);
  const cost = slots.flatMap((slot) => slot.foods).reduce((sum, food) => sum + (food.price || 0), 0);

  return {
    seed,
    slots,
    totals: {
      calories: Math.round(dayTotals.calories),
      protein: round(dayTotals.protein, 1),
      fiber: round(dayTotals.fiber, 1),
      sugar: round(dayTotals.sugar, 1),
      fatEnergyPct: dayTotals.calories > 0 ? round((dayTotals.fat * 9) / dayTotals.calories, 3) : 0
    },
    projectedScore: projected.score,
    kitchenCost: round(cost, 2),
    note: 'Projected score assumes you also get 30 active minutes.'
  };
}

// ---------------------------------------------------------------------------
// "Right now" coach tips
// ---------------------------------------------------------------------------
const SLOT_ORDER = ['breakfast', 'lunch', 'supper', 'late'];

function coachTips({ today, targets, currentSlot, waterMl, waterTarget, mealsBySlot }) {
  const tips = [];
  const slotIndex = SLOT_ORDER.indexOf(currentSlot === 'snack' ? 'lunch' : currentSlot);
  const proteinLeft = targets.protein - today.protein;
  const fiberLeft = targets.fiber - today.fiber;
  const energyRatio = today.calories / targets.calories;

  if (today.sugar > targets.sugarLimit) {
    tips.push({ tone: 'warn', icon: 'sugar', title: 'Sugar limit reached', text: `You've had ${Math.round(today.sugar)} g of sugar today (limit ${targets.sugarLimit} g). Choose water for the rest of the day.` });
  }
  if (slotIndex >= 1 && !mealsBySlot.has('breakfast')) {
    tips.push({ tone: 'info', icon: 'sun', title: 'No breakfast logged', text: 'Tomorrow, try porridge with eggs or a peanut butter sandwich before lectures. It helps concentration.' });
  }
  if (slotIndex <= 2 && proteinLeft > 15) {
    tips.push({ tone: 'info', icon: 'protein', title: `${Math.round(proteinLeft)} g protein to go`, text: 'Chicken, fish, beef, beans or eggs at your next meal will cover it.' });
  }
  if (slotIndex <= 2 && fiberLeft > 8) {
    tips.push({ tone: 'info', icon: 'leaf', title: `${Math.round(fiberLeft)} g fibre to go`, text: 'Add a garden salad, beans or vegetables, or choose sadza over chips.' });
  }
  if (waterMl < waterTarget * (slotIndex >= 1 ? 0.5 : 0.25)) {
    const glasses = Math.ceil((waterTarget - waterMl) / 250);
    tips.push({ tone: 'info', icon: 'water', title: 'Drink some water', text: `${glasses} more glasses gets you to ${(waterTarget / 1000).toFixed(1)} litres today.` });
  }
  if (today.activeMinutes < targets.activityMinutes) {
    const left = Math.round(targets.activityMinutes - today.activeMinutes);
    tips.push({ tone: 'move', icon: 'walk', title: `${left} active minutes to go`, text: 'A brisk walk to the library or around campus counts.' });
  }
  if (energyRatio > 1.1) {
    tips.push({ tone: 'warn', icon: 'energy', title: 'Energy target reached', text: 'You have eaten enough energy for today. Keep any more snacks light, such as fruit.' });
  }
  if (!tips.length) {
    tips.push({ tone: 'good', icon: 'star', title: 'Great balance today', text: 'You are on track with your targets. Keep it up!' });
  }
  return tips.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Weekly report card (last 7 complete days)
// ---------------------------------------------------------------------------
function weeklyReport(history, targets) {
  const logged = history.filter((day) => day.calories > 0 || day.meals > 0);
  if (!logged.length) return { loggedDays: 0 };
  const average = (key) => logged.reduce((sum, day) => sum + Number(day[key] || 0), 0) / logged.length;
  const scored = logged.map((day) => ({ day, result: model.scoreDay(day, targets) }));
  const best = scored.reduce((top, entry) => (!top || entry.result.score > top.result.score ? entry : top), null);
  const fatPct = logged.filter((day) => day.calories > 0)
    .reduce((sum, day) => sum + (day.fat * 9) / day.calories, 0) / Math.max(1, logged.filter((day) => day.calories > 0).length);

  const rows = [
    { key: 'energy', label: 'Energy', unit: 'kcal', average: Math.round(average('calories')), target: targets.calories,
      daysOnTarget: logged.filter((day) => day.calories >= targets.calories * 0.9 && day.calories <= targets.calories * 1.1).length },
    { key: 'protein', label: 'Protein', unit: 'g', average: round(average('protein'), 1), target: targets.protein,
      daysOnTarget: logged.filter((day) => day.protein >= targets.protein).length },
    { key: 'fiber', label: 'Fibre', unit: 'g', average: round(average('fiber'), 1), target: targets.fiber,
      daysOnTarget: logged.filter((day) => day.fiber >= targets.fiber).length },
    { key: 'sugar', label: 'Sugar', unit: 'g', average: round(average('sugar'), 1), target: targets.sugarLimit, limit: true,
      daysOnTarget: logged.filter((day) => day.sugar <= targets.sugarLimit).length },
    { key: 'fat', label: 'Fat (% of energy)', unit: '%', average: Math.round(fatPct * 100), target: 35, limit: true,
      daysOnTarget: logged.filter((day) => day.calories > 0 && (day.fat * 9) / day.calories <= 0.35).length },
    { key: 'breakfast', label: 'Breakfast eaten', unit: 'days', average: logged.filter((day) => day.breakfast).length, target: logged.length, count: true,
      daysOnTarget: logged.filter((day) => day.breakfast).length },
    { key: 'activity', label: 'Active minutes', unit: 'min', average: Math.round(history.reduce((sum, day) => sum + day.activeMinutes, 0) / 7), target: targets.activityMinutes,
      daysOnTarget: history.filter((day) => day.activeMinutes >= targets.activityMinutes).length }
  ].map((row) => {
    let status;
    if (row.count) status = row.average >= row.target * 0.7 ? 'good' : row.average >= row.target * 0.4 ? 'ok' : 'low';
    else if (row.limit) status = row.average <= row.target ? 'good' : row.average <= row.target * 1.3 ? 'ok' : 'low';
    else if (row.key === 'energy') {
      const ratio = row.average / row.target;
      status = ratio >= 0.9 && ratio <= 1.1 ? 'good' : ratio >= 0.75 && ratio <= 1.25 ? 'ok' : 'low';
    } else status = row.average >= row.target ? 'good' : row.average >= row.target * 0.7 ? 'ok' : 'low';
    return { ...row, status };
  });

  const goodRows = rows.filter((row) => row.status === 'good').length;
  const grade = goodRows >= 6 ? 'A' : goodRows >= 5 ? 'B' : goodRows >= 3 ? 'C' : goodRows >= 2 ? 'D' : 'E';
  return {
    loggedDays: logged.length,
    averageScore: round(scored.reduce((sum, entry) => sum + entry.result.score, 0) / scored.length, 1),
    bestDay: best ? { date: best.day.date, score: best.result.score } : null,
    grade,
    rows
  };
}

module.exports = {
  bodyMetrics,
  waterTargetMl,
  waterFromLog,
  healthScore,
  healthySwaps,
  mealPlan,
  coachTips,
  weeklyReport
};
