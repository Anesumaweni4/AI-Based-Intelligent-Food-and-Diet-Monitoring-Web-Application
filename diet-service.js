// Diet monitoring data layer: turns food diaries, collected orders and
// activity check-ins into daily records, then runs diet-model.js on them.
const { get, all, run, withTransaction } = require('./db');
const model = require('./diet-model');
const { getNutrition, getOutsideFood, listOutsideFoods } = require('./nutrition');

const TIME_ZONE = process.env.APP_TIMEZONE || 'Africa/Harare';
const ACTIVITY_TYPES = ['walking', 'running', 'sport', 'gym', 'dancing', 'cycling', 'other'];
const INTENSITY_WEIGHT = { light: 0.5, moderate: 1, vigorous: 2 };
const SLOT_DEFAULT_TIME = { breakfast: '08:00:00', lunch: '13:00:00', supper: '19:00:00', snack: '16:00:00', late: '22:00:00' };
const MAX_ORDER_SERVINGS = 3;

// ---------------------------------------------------------------------------
// Time helpers. Diet records are stored as local wall-clock time in TIME_ZONE.
// ---------------------------------------------------------------------------
const wallFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23'
});

function wallClock(date = new Date()) {
  const parts = Object.fromEntries(wallFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function todayKey() {
  return wallClock().slice(0, 10);
}

function addDays(dayKey, days) {
  const date = new Date(`${dayKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const pad = (value) => String(value).padStart(2, '0');

// A diet timestamp read back from the database, as 'YYYY-MM-DD HH:MM:SS'.
function storedWall(value) {
  if (value instanceof Date) {
    // node-postgres parses TIMESTAMP (no time zone) as process-local time,
    // so the local getters give back the stored wall-clock value.
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
      `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }
  return String(value || '').replace('T', ' ').slice(0, 19);
}

// orders.created_at / collected_at hold UTC wall-clock time (CURRENT_TIMESTAMP).
function utcStoredToInstant(value) {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(),
      value.getHours(), value.getMinutes(), value.getSeconds()));
  }
  const text = String(value || '');
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(text)) return new Date(text);
  return new Date(`${text.replace(' ', 'T')}Z`);
}

function slotForWall(wall) {
  const [hours, minutes] = wall.slice(11, 16).split(':').map(Number);
  const minuteOfDay = hours * 60 + minutes;
  if (minuteOfDay >= 300 && minuteOfDay < 630) return 'breakfast';
  if (minuteOfDay >= 630 && minuteOfDay < 930) return 'lunch';
  if (minuteOfDay >= 930 && minuteOfDay < 1260) return 'supper';
  return 'late';
}

function utcWallDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
}

// ---------------------------------------------------------------------------
// Orders collected from THE KITCHEN go into the food diary automatically
// ---------------------------------------------------------------------------
async function syncOrderMeals(userId = null) {
  const params = [utcWallDaysAgo(14)];
  let userFilter = '';
  if (userId !== null) {
    userFilter = 'AND o.user_id = ?';
    params.push(userId);
  }
  const orders = await all(
    `SELECT o.id, o.user_id, o.created_at, o.collected_at
     FROM orders o
     WHERE o.user_id IS NOT NULL
       AND o.status IN ('Collected', 'Delivered')
       AND o.created_at >= ?
       ${userFilter}
       AND NOT EXISTS (SELECT 1 FROM diet_meal_logs d WHERE d.order_id = o.id)`,
    params
  );
  let added = 0;
  for (const order of orders) {
    const items = await all(
      `SELECT oi.menu_item_id, oi.quantity, mi.name, mi.category
       FROM order_items oi
       JOIN menu_items mi ON mi.id = oi.menu_item_id
       WHERE oi.order_id = ?`,
      [order.id]
    );
    const eatenWall = wallClock(utcStoredToInstant(order.collected_at || order.created_at));
    const slot = slotForWall(eatenWall);
    await withTransaction(async (transaction) => {
      const already = await transaction.get('SELECT id FROM diet_meal_logs WHERE order_id = ?', [order.id]);
      if (already) return;
      for (const item of items) {
        const nutrition = getNutrition(item);
        await transaction.run(
          `INSERT INTO diet_meal_logs
           (user_id, menu_item_id, food_name, servings, calories, protein, carbohydrates, fat, fiber, sugar,
            eaten_at, meal_slot, source, order_id, is_drink)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'order', ?, ?)`,
          [
            order.user_id, item.menu_item_id, item.name,
            Math.min(MAX_ORDER_SERVINGS, Math.max(1, Number(item.quantity) || 1)),
            nutrition.calories, nutrition.protein, nutrition.carbohydrates, nutrition.fat, nutrition.fiber, nutrition.sugar,
            eatenWall, slot, order.id, nutrition.isDrink ? 1 : 0
          ]
        );
        added += 1;
      }
    });
  }
  return added;
}

// ---------------------------------------------------------------------------
// Daily records
// ---------------------------------------------------------------------------
function emptyDay(date, dayIndex) {
  return {
    date, dayIndex,
    calories: 0, protein: 0, carbohydrates: 0, fat: 0, fiber: 0, sugar: 0,
    meals: 0, breakfast: false, late: false, activeMinutes: 0, items: 0
  };
}

function summariseDays(dayKeys, logs, activities) {
  const days = new Map(dayKeys.map((date, index) => [date, { ...emptyDay(date, index), _slots: new Set() }]));
  for (const log of logs) {
    const wall = storedWall(log.eaten_at);
    const day = days.get(wall.slice(0, 10));
    if (!day) continue;
    const servings = Number(log.servings) || 0;
    for (const field of ['calories', 'protein', 'carbohydrates', 'fat', 'fiber', 'sugar']) {
      day[field] += (Number(log[field]) || 0) * servings;
    }
    day.items += 1;
    const slot = log.meal_slot || slotForWall(wall);
    const isDrink = Boolean(Number(log.is_drink)) || log.is_drink === true;
    if (!isDrink && ['breakfast', 'lunch', 'supper'].includes(slot)) day._slots.add(slot);
    if (!isDrink && slot === 'late') day.late = true;
  }
  for (const activity of activities) {
    const day = days.get(storedWall(activity.logged_at).slice(0, 10));
    if (!day) continue;
    day.activeMinutes += (Number(activity.minutes) || 0) * (INTENSITY_WEIGHT[activity.intensity] || 1);
  }
  return dayKeys.map((date) => {
    const day = days.get(date);
    day.meals = day._slots.size;
    day.breakfast = day._slots.has('breakfast');
    delete day._slots;
    for (const field of ['calories', 'protein', 'carbohydrates', 'fat', 'fiber', 'sugar', 'activeMinutes']) {
      day[field] = Math.round(day[field] * 10) / 10;
    }
    return day;
  });
}

function isLoggedDay(day) {
  return day.calories > 0 || day.meals > 0;
}

// Builds targets, today's score, the 7-day chart and the ML analysis for one
// student from their raw rows. `history` = 7 complete days before today.
function analyseStudent(user, logs, activities) {
  const today = todayKey();
  const historyKeys = Array.from({ length: 7 }, (_, index) => addDays(today, index - 7));
  const history = summariseDays(historyKeys, logs, activities);
  const [todayRecord] = summariseDays([today], logs, activities);
  const averageActiveMinutes = history.reduce((sum, day) => sum + day.activeMinutes, 0) / 7;
  const targets = model.computeTargets({
    age: user.age, weight: user.weight, height: user.height, sex: user.sex, averageActiveMinutes
  });
  const analysis = model.analyseWindow(history, targets);
  const todayScore = isLoggedDay(todayRecord) || todayRecord.activeMinutes > 0
    ? model.scoreDay(todayRecord, targets)
    : null;
  const week = [...history.slice(1), todayRecord].map((day) => ({
    date: day.date,
    logged: isLoggedDay(day),
    score: isLoggedDay(day) ? model.scoreDay(day, targets).score : null,
    calories: day.calories,
    protein: day.protein,
    fiber: day.fiber,
    sugar: day.sugar,
    activeMinutes: day.activeMinutes,
    isToday: day.date === today
  }));
  return { targets, analysis, todayRecord, todayScore, week, history };
}

async function loadRows(userIds) {
  if (!userIds.length) return { logs: [], activities: [] };
  const today = todayKey();
  const start = `${addDays(today, -7)} 00:00:00`;
  const end = `${addDays(today, 1)} 00:00:00`;
  const placeholders = userIds.map(() => '?').join(', ');
  const logs = await all(
    `SELECT id, user_id, menu_item_id, food_name, servings, calories, protein, carbohydrates, fat, fiber, sugar,
            eaten_at, meal_slot, source, order_id, is_drink
     FROM diet_meal_logs
     WHERE user_id IN (${placeholders}) AND eaten_at >= ? AND eaten_at < ?
     ORDER BY eaten_at DESC, id DESC`,
    [...userIds, start, end]
  );
  const activities = await all(
    `SELECT id, user_id, minutes, intensity, activity_type, logged_at
     FROM diet_activity_logs
     WHERE user_id IN (${placeholders}) AND logged_at >= ? AND logged_at < ?
     ORDER BY logged_at DESC, id DESC`,
    [...userIds, start, end]
  );
  return { logs, activities };
}

// ---------------------------------------------------------------------------
// Whole student body (used for "similar students" and the admin summary)
// ---------------------------------------------------------------------------
let cohortCache = null;
const COHORT_TTL_MS = 5 * 60 * 1000;

function invalidateCohort() {
  cohortCache = null;
}

async function getCohort({ fresh = false } = {}) {
  if (!fresh && cohortCache && Date.now() - cohortCache.at < COHORT_TTL_MS) return cohortCache.students;
  await syncOrderMeals(null);
  const users = await all("SELECT id, age, weight, height, sex FROM users WHERE role = 'staff'");
  const { logs, activities } = await loadRows(users.map((user) => user.id));
  const logsByUser = new Map();
  const activitiesByUser = new Map();
  for (const log of logs) {
    if (!logsByUser.has(Number(log.user_id))) logsByUser.set(Number(log.user_id), []);
    logsByUser.get(Number(log.user_id)).push(log);
  }
  for (const activity of activities) {
    if (!activitiesByUser.has(Number(activity.user_id))) activitiesByUser.set(Number(activity.user_id), []);
    activitiesByUser.get(Number(activity.user_id)).push(activity);
  }
  const students = users.map((user) => {
    const result = analyseStudent(user, logsByUser.get(Number(user.id)) || [], activitiesByUser.get(Number(user.id)) || []);
    return {
      userId: Number(user.id),
      profileComplete: result.targets.complete,
      ready: result.analysis.ready,
      cluster: result.analysis.ready ? result.analysis.cluster : null,
      risk: result.analysis.ready ? result.analysis.risk : null,
      features: result.analysis.ready ? result.analysis.features : null,
      week: result.week
    };
  });
  cohortCache = { at: Date.now(), students };
  return students;
}

async function getPeerPopularity(clusterId, excludeUserId) {
  if (clusterId === null || clusterId === undefined) return new Map();
  const cohort = await getCohort();
  const peers = cohort.filter((student) => student.cluster && student.cluster.id === clusterId && student.userId !== excludeUserId);
  if (!peers.length) return new Map();
  const placeholders = peers.map(() => '?').join(', ');
  const rows = await all(
    `SELECT oi.menu_item_id, SUM(oi.quantity) AS total
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     WHERE o.user_id IN (${placeholders}) AND o.status <> 'Cancelled' AND o.created_at >= ?
     GROUP BY oi.menu_item_id`,
    [...peers.map((peer) => peer.userId), utcWallDaysAgo(30)]
  );
  return new Map(rows.map((row) => [Number(row.menu_item_id), Number(row.total)]));
}

// ---------------------------------------------------------------------------
// Student dashboard
// ---------------------------------------------------------------------------
async function getStudentDashboard(userId) {
  await syncOrderMeals(userId);
  const user = await get('SELECT id, age, weight, height, sex FROM users WHERE id = ?', [userId]);
  const { logs, activities } = await loadRows([userId]);
  const result = analyseStudent(user, logs, activities);
  const today = todayKey();

  const profile = await get('SELECT goal FROM diet_profiles WHERE user_id = ?', [userId]);
  const goal = profile ? profile.goal : 'balanced';
  const menuItems = await all('SELECT id, name, category, stock_quantity FROM menu_items ORDER BY name');
  const feedback = await all(
    'SELECT rating, calories, protein, carbohydrates, fat, fiber FROM diet_feedback WHERE user_id = ?',
    [userId]
  );
  const todayLogs = logs.filter((log) => storedWall(log.eaten_at).slice(0, 10) === today);
  const todayForRecommendations = {
    ...result.todayRecord,
    foodNames: new Set(todayLogs.map((log) => String(log.food_name).toLowerCase()))
  };
  const peerPopularity = result.analysis.ready && result.analysis.cluster
    ? await getPeerPopularity(result.analysis.cluster.id, userId)
    : new Map();
  const inStock = menuItems.filter((item) => item.stock_quantity === null || item.stock_quantity === undefined || Number(item.stock_quantity) > 0);
  // Prefer items in stock; if stock has not been counted yet, use the whole menu.
  const available = inStock.length >= 5 ? inStock : menuItems;
  const recommendation = model.recommendFoods({
    foods: available,
    feedback,
    goal,
    today: todayForRecommendations,
    targets: result.targets,
    peerPopularity
  });

  return {
    goal,
    profile: {
      age: user.age === null ? null : Number(user.age),
      weight: user.weight === null ? null : Number(user.weight),
      height: user.height === null ? null : Number(user.height),
      sex: user.sex || null,
      complete: result.targets.complete
    },
    targets: result.targets,
    today: {
      date: today,
      totals: result.todayRecord,
      score: result.todayScore,
      meals: todayLogs.map((log) => ({
        id: Number(log.id),
        foodName: log.food_name,
        servings: Number(log.servings),
        calories: Math.round(Number(log.calories) * Number(log.servings)),
        protein: Math.round(Number(log.protein) * Number(log.servings) * 10) / 10,
        fiber: Math.round(Number(log.fiber) * Number(log.servings) * 10) / 10,
        sugar: Math.round(Number(log.sugar) * Number(log.servings) * 10) / 10,
        slot: log.meal_slot || slotForWall(storedWall(log.eaten_at)),
        source: log.source || 'manual',
        time: storedWall(log.eaten_at).slice(11, 16)
      })),
      activities: activities
        .filter((activity) => storedWall(activity.logged_at).slice(0, 10) === today)
        .map((activity) => ({
          id: Number(activity.id),
          minutes: Number(activity.minutes),
          intensity: activity.intensity,
          type: activity.activity_type,
          time: storedWall(activity.logged_at).slice(11, 16)
        }))
    },
    week: result.week,
    insight: result.analysis.ready
      ? {
          ready: true,
          cluster: result.analysis.cluster,
          risk: result.analysis.risk,
          features: result.analysis.features
        }
      : { ready: false, loggedDays: result.analysis.loggedDays, neededDays: result.analysis.neededDays },
    recommendations: recommendation.items,
    recommendationModel: recommendation.model,
    foods: menuItems.map((item) => {
      const nutrition = getNutrition(item);
      return { id: Number(item.id), name: item.name, category: item.category, ...nutrition };
    }),
    outsideFoods: listOutsideFoods(),
    model: model.modelSummary(),
    timeZone: TIME_ZONE,
    currentSlot: slotForWall(wallClock())
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
function resolveDayWall(day, slot) {
  if (day === 'yesterday') {
    return `${addDays(todayKey(), -1)} ${SLOT_DEFAULT_TIME[slot] || '12:00:00'}`;
  }
  return wallClock();
}

async function logMeal(userId, { menuItemId, foodKey, servings, slot, day }) {
  let food;
  let nutrition;
  let storedMenuItemId = 0;
  if (foodKey) {
    nutrition = getOutsideFood(foodKey);
    if (!nutrition) return { status: 404, message: 'That food is not in the list.' };
    food = { name: nutrition.name };
  } else {
    food = await get('SELECT id, name, category FROM menu_items WHERE id = ?', [menuItemId]);
    if (!food) return { status: 404, message: 'That food is no longer available in the menu.' };
    nutrition = getNutrition(food);
    storedMenuItemId = Number(food.id);
  }
  const eatenAt = resolveDayWall(day, slot);
  const mealSlot = slot || slotForWall(eatenAt);
  const result = await run(
    `INSERT INTO diet_meal_logs
     (user_id, menu_item_id, food_name, servings, calories, protein, carbohydrates, fat, fiber, sugar,
      eaten_at, meal_slot, source, is_drink)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
    [
      userId, storedMenuItemId, food.name, servings,
      nutrition.calories, nutrition.protein, nutrition.carbohydrates, nutrition.fat, nutrition.fiber, nutrition.sugar,
      eatenAt, mealSlot, nutrition.isDrink ? 1 : 0
    ]
  );
  invalidateCohort();
  return { status: 201, message: `${food.name} added to your food diary.`, id: result.id };
}

async function deleteMeal(userId, logId) {
  const result = await run('DELETE FROM diet_meal_logs WHERE id = ? AND user_id = ?', [logId, userId]);
  invalidateCohort();
  return result.changes > 0;
}

async function logActivity(userId, { minutes, intensity, type, day }) {
  const loggedAt = resolveDayWall(day, 'snack');
  const result = await run(
    'INSERT INTO diet_activity_logs (user_id, minutes, intensity, activity_type, logged_at) VALUES (?, ?, ?, ?, ?)',
    [userId, minutes, intensity, type, loggedAt]
  );
  invalidateCohort();
  return result.id;
}

async function deleteActivity(userId, activityId) {
  const result = await run('DELETE FROM diet_activity_logs WHERE id = ? AND user_id = ?', [activityId, userId]);
  invalidateCohort();
  return result.changes > 0;
}

async function updateProfile(userId, { age, weight, height, sex }) {
  await run('UPDATE users SET age = ?, weight = ?, height = ?, sex = ? WHERE id = ?', [age, weight, height, sex, userId]);
  invalidateCohort();
}

// ---------------------------------------------------------------------------
// Admin summary (anonymous totals only)
// ---------------------------------------------------------------------------
async function getAdminInsights() {
  const students = await getCohort({ fresh: true });
  const ready = students.filter((student) => student.ready);
  const loadedModels = model.getLoadedModels();
  const clusterDefinitions = loadedModels ? loadedModels.clustering.clusters : [];
  const clusters = clusterDefinitions.map((cluster) => ({
    id: cluster.id,
    name: cluster.name,
    description: cluster.description,
    tip: cluster.tip,
    students: ready.filter((student) => student.cluster && student.cluster.id === cluster.id).length
  }));
  const riskCounts = { high: 0, medium: 0, low: 0 };
  for (const student of ready) {
    if (student.risk && riskCounts[student.risk.level] !== undefined) riskCounts[student.risk.level] += 1;
  }
  const share = (test) => (ready.length ? Math.round((ready.filter(test).length / ready.length) * 100) : 0);
  const concerns = [
    { key: 'sugar', label: 'Too much sugar', percent: share((student) => student.features.sugar_ratio_mean > 1) },
    { key: 'protein', label: 'Not enough protein', percent: share((student) => student.features.protein_ratio_mean < 0.8) },
    { key: 'fiber', label: 'Not enough fibre', percent: share((student) => student.features.fiber_ratio_mean < 0.6) },
    { key: 'breakfast', label: 'Often skip breakfast', percent: share((student) => student.features.breakfast_rate < 0.4) },
    { key: 'energy-low', label: 'Eating too little', percent: share((student) => student.features.energy_ratio_mean < 0.8) },
    { key: 'activity', label: 'Under 15 active minutes a day', percent: share((student) => student.features.active_minutes_mean < 15) }
  ].sort((left, right) => right.percent - left.percent);

  const today = todayKey();
  const dailyAverages = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, index - 6);
    const scores = students
      .map((student) => student.week.find((day) => day.date === date))
      .filter((day) => day && day.score !== null)
      .map((day) => day.score);
    return {
      date,
      students: scores.length,
      averageScore: scores.length ? Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 10) / 10 : null
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    students: students.length,
    studentsWithData: ready.length,
    profilesComplete: students.filter((student) => student.profileComplete).length,
    loggedToday: students.filter((student) => {
      const day = student.week.find((entry) => entry.isToday);
      return day && day.logged;
    }).length,
    clusters,
    risk: riskCounts,
    concerns,
    dailyAverages,
    model: model.modelSummary()
  };
}

module.exports = {
  ACTIVITY_TYPES,
  INTENSITY_WEIGHT,
  TIME_ZONE,
  getStudentDashboard,
  getAdminInsights,
  logMeal,
  deleteMeal,
  logActivity,
  deleteActivity,
  updateProfile,
  syncOrderMeals,
  invalidateCohort,
  // exported for tests
  _internal: { wallClock, storedWall, utcStoredToInstant, slotForWall, summariseDays, addDays }
};
