const NUTRITION_BY_NAME = [
  { match: /beef burger.*chips|burger.*chips/, values: [680, 30, 72, 30, 7] },
  { match: /beef burger/, values: [480, 26, 42, 22, 4] },
  { match: /chicken wrap/, values: [520, 30, 48, 22, 5] },
  { match: /rice.*stew/, values: [610, 24, 84, 18, 8] },
  { match: /noodles/, values: [560, 22, 78, 18, 7] },
  { match: /chips.*chicken|chicken.*chips/, values: [690, 32, 64, 34, 6] },
  { match: /smoothie/, values: [230, 8, 42, 4, 5] },
  { match: /minute maid|pepsi|coca.?cola|coke|soft drink/, values: [150, 0, 39, 0, 0] }
];

const GENERIC_BY_CATEGORY = {
  drink: [160, 2, 30, 3, 2],
  burger: [550, 27, 50, 26, 5],
  wrap: [500, 26, 48, 20, 5],
  meal: [600, 24, 78, 20, 7],
  noodles: [560, 22, 78, 18, 7],
  side: [420, 12, 48, 20, 5]
};

const GOALS = new Set(['balanced', 'protein', 'fiber', 'variety']);

function getNutrition(item) {
  const name = String(item.name || '').toLowerCase();
  const known = NUTRITION_BY_NAME.find((entry) => entry.match.test(name));
  if (known) {
    return {
      calories: known.values[0],
      protein: known.values[1],
      carbohydrates: known.values[2],
      fat: known.values[3],
      fiber: known.values[4],
      estimateType: 'menu estimate'
    };
  }

  const category = String(item.category || '').toLowerCase();
  const categoryKey = Object.keys(GENERIC_BY_CATEGORY).find((key) => category.includes(key));
  const values = GENERIC_BY_CATEGORY[categoryKey] || [500, 20, 60, 18, 5];
  return {
    calories: values[0],
    protein: values[1],
    carbohydrates: values[2],
    fat: values[3],
    fiber: values[4],
    estimateType: 'category estimate'
  };
}

function getFeatures(food) {
  return [
    Number(food.calories) / 700,
    Number(food.protein) / 40,
    Number(food.carbohydrates) / 90,
    Number(food.fat) / 40,
    Number(food.fiber) / 12
  ];
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, value))));
}

function trainPreferenceModel(feedback) {
  const examples = feedback.filter((entry) => entry.rating === -1 || entry.rating === 1);
  const classes = new Set(examples.map((entry) => entry.rating));
  if (examples.length < 2 || classes.size < 2) return null;

  const weights = [0, 0, 0, 0, 0];
  let bias = 0;
  const learningRate = 0.08;
  const regularization = 0.025;

  for (let epoch = 0; epoch < 160; epoch += 1) {
    for (const example of examples) {
      const features = getFeatures(example);
      const target = example.rating === 1 ? 1 : 0;
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
    predict: (food) => sigmoid(bias + weights.reduce(
      (sum, weight, index) => sum + weight * getFeatures(food)[index],
      0
    ))
  };
}

function getNutritionFit(food, goal, dailyTotals) {
  const calories = Number(food.calories);
  const protein = Number(food.protein);
  const fiber = Number(food.fiber);
  const caloriesScore = Math.max(0, 1 - Math.abs(calories - 500) / 700);
  const proteinScore = Math.min(protein / 30, 1);
  const fiberScore = Math.min(fiber / 8, 1);
  const proteinWeight = goal === 'protein' ? 0.55 : (goal === 'balanced' && dailyTotals.protein < 35 ? 0.4 : 0.25);
  const fiberWeight = goal === 'fiber' ? 0.5 : (goal === 'balanced' && dailyTotals.fiber < 8 ? 0.35 : 0.25);
  const varietyScore = dailyTotals.foodNames.has(String(food.name).toLowerCase()) ? 0.2 : 1;
  const varietyWeight = goal === 'variety' ? 0.45 : 0.15;
  const baseWeight = 1 - proteinWeight - fiberWeight - varietyWeight;

  return (
    caloriesScore * baseWeight +
    proteinScore * proteinWeight +
    fiberScore * fiberWeight +
    varietyScore * varietyWeight
  );
}

function recommendFoods({ foods, feedback, goal = 'balanced', dailyTotals }) {
  const normalizedGoal = GOALS.has(goal) ? goal : 'balanced';
  const preferenceModel = trainPreferenceModel(feedback);

  const recommendations = foods.map((food) => {
    const nutrition = getNutrition(food);
    const nutritionFit = getNutritionFit(
      { ...food, ...nutrition },
      normalizedGoal,
      dailyTotals
    );
    const learnedPreference = preferenceModel ? preferenceModel.predict(nutrition) : null;
    const rawScore = preferenceModel
      ? nutritionFit * 0.7 + learnedPreference * 0.3
      : nutritionFit;
    const score = Math.max(0, Math.min(1, rawScore));

    let reason = 'A balanced general-purpose option.';
    if (normalizedGoal === 'protein' || (normalizedGoal === 'balanced' && dailyTotals.protein < 35)) {
      reason = `${nutrition.protein} g estimated protein per serving.`;
    } else if (normalizedGoal === 'fiber' || (normalizedGoal === 'balanced' && dailyTotals.fiber < 8)) {
      reason = `${nutrition.fiber} g estimated fiber per serving.`;
    } else if (normalizedGoal === 'variety' && !dailyTotals.foodNames.has(String(food.name).toLowerCase())) {
      reason = 'Adds variety compared with meals logged today.';
    } else if (preferenceModel) {
      reason = `Nutrition fit plus a ${Math.round(learnedPreference * 100)}% learned preference score.`;
    }

    return {
      id: food.id,
      name: food.name,
      category: food.category,
      ...nutrition,
      score: Math.round(score * 100),
      reason
    };
  });

  recommendations.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  return {
    items: recommendations.slice(0, 5),
    model: {
      name: preferenceModel ? 'Personalized logistic preference model' : 'Nutrition-fit cold-start model',
      feedbackCount: preferenceModel ? preferenceModel.observations : feedback.length,
      trained: Boolean(preferenceModel),
      trainingHint: preferenceModel
        ? 'The ranking combines nutrition fit with your past helpful/not-helpful feedback.'
        : 'Rate suggestions as helpful and not helpful to train your personal preference model.'
    }
  };
}

module.exports = { getNutrition, recommendFoods, GOALS };
