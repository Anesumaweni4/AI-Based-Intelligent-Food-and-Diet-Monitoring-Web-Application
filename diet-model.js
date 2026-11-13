// Diet intelligence engine.
//
//  1. Personal targets      - Mifflin-St Jeor energy equation x activity factor.
//  2. Daily diet score      - 0-100 index built from WHO healthy-diet guidance.
//  3. Weekly features       - 13 numbers that describe a student's last 7 days.
//  4. Model A (clustering)  - K-means eating-pattern groups, trained offline.
//  5. Model B (risk)        - classifier that predicts a poor diet over the next
//                             7 days, trained offline (best of several models).
//  6. Model C (recommender) - gap-filling nutrition fit + learned personal
//                             preference (logistic regression trained on the
//                             student's own feedback) + what similar students
//                             (same eating pattern) buy.
//
// The definitions in sections 1-3 are mirrored exactly in ml/diet_science.py.
// `npm run ml:test` checks that both give the same answers.
const fs = require('fs');
const path = require('path');
const { getNutrition } = require('./nutrition');

const GOALS = new Set(['balanced', 'protein', 'fiber', 'variety']);
const FIBRE_TARGET_G = 25;
const FAT_ENERGY_LIMIT = 0.35;
const ACTIVITY_TARGET_MIN = 30;
const SCORE_WEIGHTS = { energy: 25, protein: 20, fiber: 15, sugar: 15, fat: 10, regularity: 10, activity: 5 };
const MEAL_SLOTS = ['breakfast', 'lunch', 'supper', 'snack', 'late'];
const FEATURE_NAMES = [
  'energy_ratio_mean',
  'energy_ratio_std',
  'protein_ratio_mean',
  'fiber_ratio_mean',
  'sugar_ratio_mean',
  'fat_energy_pct_mean',
  'meals_per_day_mean',
  'breakfast_rate',
  'late_meal_rate',
  'active_minutes_mean',
  'score_mean',
  'score_trend',
  'recent_score_mean'
];
const MIN_LOGGED_DAYS = 3;

// ---------------------------------------------------------------------------
// 1. Targets
// ---------------------------------------------------------------------------
function activityFactor(averageActiveMinutes) {
  const minutes = Number(averageActiveMinutes) || 0;
  if (minutes < 15) return 1.4;
  if (minutes < 30) return 1.55;
  if (minutes < 60) return 1.7;
  return 1.85;
}

function computeTargets({ age, weight, height, sex, averageActiveMinutes = 0 }) {
  const parsedAge = Number(age);
  const parsedWeight = Number(weight);
  const parsedHeight = Number(height);
  const complete = parsedAge > 0 && parsedWeight > 0 && parsedHeight > 0 && (sex === 'female' || sex === 'male');
  const pal = activityFactor(averageActiveMinutes);

  let bmr = null;
  let calories;
  if (complete) {
    bmr = 10 * parsedWeight + 6.25 * parsedHeight - 5 * parsedAge + (sex === 'male' ? 5 : -161);
    calories = bmr * pal;
  } else {
    calories = sex === 'female' ? 2000 : sex === 'male' ? 2500 : 2200;
  }
  calories = Math.round(Math.min(3600, Math.max(1400, calories)));
  const protein = Math.round(Math.max(45, (parsedWeight > 0 ? parsedWeight : 60) * 0.8));
  const sugarLimit = Math.round((calories * 0.10) / 4);

  return {
    calories,
    protein,
    fiber: FIBRE_TARGET_G,
    sugarLimit,
    fatEnergyLimit: FAT_ENERGY_LIMIT,
    activityMinutes: ACTIVITY_TARGET_MIN,
    bmr: bmr === null ? null : Math.round(bmr),
    activityFactor: pal,
    complete
  };
}

// ---------------------------------------------------------------------------
// 2. Daily diet score
// ---------------------------------------------------------------------------
function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function round(value, places = 1) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// day: { calories, protein, fiber, sugar, fat, meals, breakfast, late, activeMinutes }
function scoreDay(day, targets) {
  const calories = Number(day.calories) || 0;
  const energyRatio = calories / targets.calories;
  let energy;
  if (energyRatio < 0.9) energy = clamp01((energyRatio - 0.5) / 0.4);
  else if (energyRatio > 1.1) energy = clamp01((1.5 - energyRatio) / 0.4);
  else energy = 1;

  const protein = clamp01((Number(day.protein) || 0) / targets.protein);
  const fiber = clamp01((Number(day.fiber) || 0) / targets.fiber);
  const sugarRatio = (Number(day.sugar) || 0) / targets.sugarLimit;
  const sugar = sugarRatio <= 1 ? 1 : clamp01(2 - sugarRatio);
  const fatPct = calories > 0 ? ((Number(day.fat) || 0) * 9) / calories : 0;
  const fat = calories <= 0 ? 0 : fatPct <= FAT_ENERGY_LIMIT ? 1 : clamp01((0.5 - fatPct) / (0.5 - FAT_ENERGY_LIMIT));
  const meals = Number(day.meals) || 0;
  const mealPoints = meals >= 3 ? 6 : meals === 2 ? 4 : meals === 1 ? 1 : 0;
  const regularity = (mealPoints + (day.breakfast ? 4 : 0)) / 10;
  const activity = clamp01((Number(day.activeMinutes) || 0) / ACTIVITY_TARGET_MIN);

  const parts = {
    energy: energy * SCORE_WEIGHTS.energy,
    protein: protein * SCORE_WEIGHTS.protein,
    fiber: fiber * SCORE_WEIGHTS.fiber,
    sugar: sugar * SCORE_WEIGHTS.sugar,
    fat: fat * SCORE_WEIGHTS.fat,
    regularity: regularity * SCORE_WEIGHTS.regularity,
    activity: activity * SCORE_WEIGHTS.activity
  };
  const score = Object.values(parts).reduce((sum, value) => sum + value, 0);
  return {
    score: round(score, 1),
    parts: Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, round(value, 1)])),
    ratios: {
      energy: round(energyRatio, 3),
      protein: round((Number(day.protein) || 0) / targets.protein, 3),
      fiber: round((Number(day.fiber) || 0) / targets.fiber, 3),
      sugar: round(sugarRatio, 3),
      fatEnergyPct: round(fatPct, 3)
    }
  };
}

// ---------------------------------------------------------------------------
// 3. Weekly features (only days with at least one food logged)
// ---------------------------------------------------------------------------
function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function populationStd(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function slope(xs, ys) {
  if (xs.length < 2) return 0;
  const xMean = mean(xs);
  const yMean = mean(ys);
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < xs.length; index += 1) {
    numerator += (xs[index] - xMean) * (ys[index] - yMean);
    denominator += (xs[index] - xMean) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

// days: [{ dayIndex (0 = oldest), calories, protein, fiber, sugar, fat, meals, breakfast, late, activeMinutes }]
function weeklyFeatures(days, targets) {
  const logged = days.filter((day) => Number(day.calories) > 0 || Number(day.meals) > 0);
  if (logged.length < MIN_LOGGED_DAYS) return null;
  const scored = logged.map((day) => ({ day, result: scoreDay(day, targets) }));
  const energyRatios = scored.map(({ result }) => result.ratios.energy);
  const fatPcts = scored.filter(({ day }) => Number(day.calories) > 0).map(({ result }) => result.ratios.fatEnergyPct);
  const scores = scored.map(({ result }) => result.score);

  return [
    mean(energyRatios),
    populationStd(energyRatios),
    mean(scored.map(({ result }) => Math.min(2, result.ratios.protein))),
    mean(scored.map(({ result }) => Math.min(2, result.ratios.fiber))),
    mean(scored.map(({ result }) => Math.min(4, result.ratios.sugar))),
    mean(fatPcts),
    mean(logged.map((day) => Number(day.meals) || 0)),
    mean(logged.map((day) => (day.breakfast ? 1 : 0))),
    mean(logged.map((day) => (day.late ? 1 : 0))),
    mean(logged.map((day) => Math.min(180, Number(day.activeMinutes) || 0))),
    mean(scores),
    slope(logged.map((day) => Number(day.dayIndex)), scores),
    mean(scores.slice(-3))
  ].map((value) => round(value, 4));
}

// ---------------------------------------------------------------------------
// 4 + 5. Trained models (ml/models/diet_models.json)
// ---------------------------------------------------------------------------
const MODEL_FILE = path.join(__dirname, 'ml', 'models', 'diet_models.json');
let trainedModels = null;
try {
  trainedModels = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));
} catch (error) {
  console.warn(`Diet ML models not loaded (${error.message}). Run "npm run ml:train" to create them.`);
}

function standardize(values, indexes, meanValues, scaleValues) {
  return indexes.map((featureIndex, position) =>
    (values[featureIndex] - meanValues[position]) / (scaleValues[position] || 1));
}

function assignCluster(features, model = trainedModels) {
  if (!features || !model || !model.clustering) return null;
  const clustering = model.clustering;
  const point = standardize(features, clustering.featureIndexes, clustering.mean, clustering.scale);
  let best = null;
  clustering.centroids.forEach((centroid, index) => {
    const distance = centroid.reduce((sum, value, position) => sum + (value - point[position]) ** 2, 0);
    if (!best || distance < best.distance) best = { index, distance };
  });
  const cluster = clustering.clusters[best.index];
  return { id: best.index, name: cluster.name, description: cluster.description, tip: cluster.tip };
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
}

function evaluateTree(tree, values) {
  let node = 0;
  while (tree.left[node] !== -1) {
    node = values[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
  }
  return tree.value[node];
}

function riskProbability(features, model = trainedModels) {
  if (!features || !model || !model.risk) return null;
  const risk = model.risk;
  const values = risk.featureIndexes.map((index) => features[index]);
  if (risk.algorithm === 'logistic_regression') {
    const scaled = values.map((value, position) => (value - risk.mean[position]) / (risk.scale[position] || 1));
    return sigmoid(risk.intercept + scaled.reduce((sum, value, position) => sum + value * risk.coef[position], 0));
  }
  if (risk.algorithm === 'decision_tree') {
    return evaluateTree(risk.trees[0], values);
  }
  // random_forest: average of the trees' leaf probabilities
  return mean(risk.trees.map((tree) => evaluateTree(tree, values)));
}

function explainRisk(features, targets) {
  const [energy, , protein, fiber, sugar, fatPct, meals, breakfast, late, active, , trend] = features;
  const reasons = [];
  if (energy < 0.8) reasons.push({ weight: 0.8 - energy, text: `Eating about ${Math.round(energy * 100)}% of the energy you need` });
  if (energy > 1.2) reasons.push({ weight: energy - 1.2, text: `Eating about ${Math.round(energy * 100)}% of the energy you need` });
  if (sugar > 1) reasons.push({ weight: (sugar - 1) * 0.8, text: `Sugar is ${sugar.toFixed(1)}× the daily limit of ${targets.sugarLimit} g` });
  if (protein < 0.8) reasons.push({ weight: 0.8 - protein, text: `Protein is only ${Math.round(protein * 100)}% of your ${targets.protein} g target` });
  if (fiber < 0.6) reasons.push({ weight: (0.6 - fiber) * 0.8, text: `Fibre is only ${Math.round(fiber * 100)}% of the ${targets.fiber} g target` });
  if (fatPct > FAT_ENERGY_LIMIT) reasons.push({ weight: (fatPct - FAT_ENERGY_LIMIT) * 3, text: `${Math.round(fatPct * 100)}% of energy comes from fat (aim for under 35%)` });
  if (meals < 2) reasons.push({ weight: (2 - meals) * 0.5, text: `Only ${meals.toFixed(1)} proper meals a day on average` });
  if (breakfast < 0.4) reasons.push({ weight: (0.4 - breakfast) * 0.6, text: 'Breakfast is often skipped' });
  if (late > 0.5) reasons.push({ weight: (late - 0.5) * 0.5, text: 'Eating late at night most days' });
  if (active < 15) reasons.push({ weight: (15 - active) / 40, text: `About ${Math.round(active)} active minutes a day (aim for ${ACTIVITY_TARGET_MIN})` });
  if (trend < -2) reasons.push({ weight: Math.min(1, -trend / 10), text: 'Your daily scores have been falling this week' });
  return reasons.sort((left, right) => right.weight - left.weight).slice(0, 3).map((reason) => reason.text);
}

function analyseWindow(days, targets) {
  const features = weeklyFeatures(days, targets);
  if (!features) {
    const loggedDays = days.filter((day) => Number(day.calories) > 0 || Number(day.meals) > 0).length;
    return { ready: false, loggedDays, neededDays: MIN_LOGGED_DAYS };
  }
  const cluster = assignCluster(features);
  const probability = riskProbability(features);
  const threshold = trainedModels && trainedModels.risk ? trainedModels.risk.threshold : 0.5;
  let level = null;
  if (probability !== null) {
    level = probability >= Math.max(threshold, 0.65) ? 'high' : probability >= threshold ? 'medium' : 'low';
  }
  return {
    ready: true,
    features: Object.fromEntries(FEATURE_NAMES.map((name, index) => [name, features[index]])),
    featureVector: features,
    cluster,
    risk: probability === null ? null : {
      probability: round(probability, 3),
      level,
      reasons: explainRisk(features, targets)
    }
  };
}

function modelSummary() {
  if (!trainedModels) return { loaded: false };
  return {
    loaded: true,
    trainedAt: trainedModels.trainedAt,
    dataset: trainedModels.dataset,
    clustering: {
      algorithm: 'K-means',
      k: trainedModels.clustering.k,
      silhouette: trainedModels.clustering.silhouette
    },
    risk: {
      algorithm: trainedModels.risk.label,
      metrics: trainedModels.risk.metrics
    }
  };
}

// ---------------------------------------------------------------------------
// 6. Recommendations
// ---------------------------------------------------------------------------
function getFeatures(food) {
  return [
    Number(food.calories) / 700,
    Number(food.protein) / 40,
    Number(food.carbohydrates) / 90,
    Number(food.fat) / 40,
    Number(food.fiber) / 12
  ];
}

// Personal preference: logistic regression trained on this student's own
// helpful / not helpful ratings (gradient descent with L2 regularisation).
function trainPreferenceModel(feedback) {
  const examples = feedback.filter((entry) => Number(entry.rating) === -1 || Number(entry.rating) === 1);
  const classes = new Set(examples.map((entry) => Number(entry.rating)));
  if (examples.length < 2 || classes.size < 2) return null;

  const weights = [0, 0, 0, 0, 0];
  let bias = 0;
  const learningRate = 0.08;
  const regularization = 0.025;

  for (let epoch = 0; epoch < 160; epoch += 1) {
    for (const example of examples) {
      const features = getFeatures(example);
      const target = Number(example.rating) === 1 ? 1 : 0;
      const prediction = sigmoid(bias + weights.reduce((sum, weight, index) => sum + weight * features[index], 0));
      const error = prediction - target;
      bias -= learningRate * error;
      for (let index = 0; index < weights.length; index += 1) {
        weights[index] -= learningRate * (error * features[index] + regularization * weights[index]);
      }
    }
  }

  return {
    observations: examples.length,
    predict: (food) => sigmoid(bias + weights.reduce((sum, weight, index) => sum + weight * getFeatures(food)[index], 0))
  };
}

// today: { calories, protein, fiber, sugar, fat, meals, foodNames:Set }
function recommendFoods({ foods, feedback = [], goal = 'balanced', today, targets, peerPopularity = new Map(), limit = 5 }) {
  const normalizedGoal = GOALS.has(goal) ? goal : 'balanced';
  const preferenceModel = trainPreferenceModel(feedback);
  const mealsLeft = Math.max(1, 3 - (Number(today.meals) || 0));
  const remaining = {
    calories: Math.max(0, targets.calories - (Number(today.calories) || 0)),
    protein: Math.max(0, targets.protein - (Number(today.protein) || 0)),
    fiber: Math.max(0, targets.fiber - (Number(today.fiber) || 0)),
    sugar: targets.sugarLimit - (Number(today.sugar) || 0)
  };
  const idealMealCalories = Math.min(900, Math.max(250, remaining.calories / mealsLeft));
  const proteinPerMeal = Math.max(8, remaining.protein / mealsLeft);
  const fiberPerMeal = Math.max(3, remaining.fiber / mealsLeft);
  const maxPeer = Math.max(1, ...peerPopularity.values());

  const scored = foods.map((food) => {
    const nutrition = getNutrition(food);
    if (nutrition.isDrink && nutrition.sugar > 15) return null;
    if (nutrition.calories <= 0 && !nutrition.isDrink) return null;

    const energyFit = nutrition.isDrink ? 0.5 : clamp01(1 - Math.abs(nutrition.calories - idealMealCalories) / idealMealCalories);
    const proteinFit = clamp01(nutrition.protein / proteinPerMeal);
    const fiberFit = clamp01(nutrition.fiber / fiberPerMeal);
    const fatPct = nutrition.calories > 0 ? (nutrition.fat * 9) / nutrition.calories : 0;
    const fatFit = fatPct <= FAT_ENERGY_LIMIT ? 1 : clamp01(1 - (fatPct - FAT_ENERGY_LIMIT) / 0.2);
    const sugarPenalty = remaining.sugar <= 0 ? clamp01(nutrition.sugar / 10) : clamp01(nutrition.sugar / Math.max(remaining.sugar, 1)) * 0.5;
    const repeated = today.foodNames && today.foodNames.has(String(food.name).toLowerCase());

    const weights = {
      balanced: { energy: 0.35, protein: 0.3, fiber: 0.2, fat: 0.15 },
      protein: { energy: 0.25, protein: 0.5, fiber: 0.1, fat: 0.15 },
      fiber: { energy: 0.25, protein: 0.15, fiber: 0.45, fat: 0.15 },
      variety: { energy: 0.35, protein: 0.25, fiber: 0.2, fat: 0.2 }
    }[normalizedGoal];
    let nutritionFit = energyFit * weights.energy + proteinFit * weights.protein + fiberFit * weights.fiber + fatFit * weights.fat;
    nutritionFit -= sugarPenalty * 0.3;
    if (repeated) nutritionFit -= normalizedGoal === 'variety' ? 0.35 : 0.1;
    nutritionFit = clamp01(nutritionFit);

    const learnedPreference = preferenceModel ? preferenceModel.predict(nutrition) : null;
    const peer = peerPopularity.has(Number(food.id)) ? peerPopularity.get(Number(food.id)) / maxPeer : null;
    let score = nutritionFit;
    if (learnedPreference !== null && peer !== null) score = nutritionFit * 0.6 + learnedPreference * 0.2 + peer * 0.2;
    else if (learnedPreference !== null) score = nutritionFit * 0.75 + learnedPreference * 0.25;
    else if (peer !== null) score = nutritionFit * 0.8 + peer * 0.2;

    const reasons = [];
    if (remaining.protein > 5 && nutrition.protein >= 20) {
      reasons.push(`${Math.round(nutrition.protein)} g protein towards the ${Math.round(remaining.protein)} g you still need`);
    }
    if (remaining.fiber > 3 && nutrition.fiber >= 4) {
      reasons.push(`${Math.round(nutrition.fiber)} g fibre (you still need ${Math.round(remaining.fiber)} g)`);
    }
    if (nutrition.isDrink && nutrition.calories === 0) reasons.push('No sugar, keeps you hydrated');
    if (!reasons.length && energyFit > 0.7) reasons.push(`${Math.round(nutrition.calories)} kcal fits your next meal`);
    if (peer !== null && peer >= 0.5) reasons.push('Popular with students who eat like you');
    if (learnedPreference !== null && learnedPreference >= 0.6) reasons.push('Matches foods you rated helpful');
    if (!reasons.length) reasons.push('A reasonable fit for what you have eaten today');

    return {
      id: food.id,
      name: food.name,
      category: food.category,
      ...nutrition,
      score: Math.round(clamp01(score) * 100),
      reason: reasons.slice(0, 2).join(' · ')
    };
  }).filter(Boolean);

  scored.sort((left, right) => right.score - left.score || String(left.name).localeCompare(String(right.name)));
  return {
    items: scored.slice(0, limit),
    model: {
      name: preferenceModel
        ? 'Nutrition gap fit + personal preference model' + (peerPopularity.size ? ' + similar students' : '')
        : peerPopularity.size ? 'Nutrition gap fit + similar students' : 'Nutrition gap fit',
      feedbackCount: preferenceModel ? preferenceModel.observations : feedback.length,
      trained: Boolean(preferenceModel),
      trainingHint: preferenceModel
        ? 'Suggestions combine what you still need today with your helpful / not helpful ratings.'
        : 'Rate suggestions as helpful or not helpful to teach the model your taste.'
    }
  };
}

module.exports = {
  GOALS,
  MEAL_SLOTS,
  FEATURE_NAMES,
  MIN_LOGGED_DAYS,
  SCORE_WEIGHTS,
  getNutrition,
  computeTargets,
  scoreDay,
  weeklyFeatures,
  assignCluster,
  riskProbability,
  analyseWindow,
  explainRisk,
  modelSummary,
  recommendFoods,
  getLoadedModels: () => trainedModels
};
