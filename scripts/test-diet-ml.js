// Checks that diet-model.js (Node) reproduces the Python training code:
// daily scores, weekly features, cluster and risk probability for the parity
// cases saved in ml/models/diet_models.json.   npm run ml:test
const assert = require('assert');
const model = require('../diet-model');

const models = model.getLoadedModels();
if (!models) {
  console.error('ml/models/diet_models.json is missing. Run "npm run ml:train" first.');
  process.exit(1);
}

let checks = 0;
function close(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
  checks += 1;
}

models.parity.forEach((testCase, caseIndex) => {
  const targets = { ...testCase.targets, fatEnergyLimit: 0.35, activityMinutes: 30 };
  testCase.days.forEach((day, dayIndex) => {
    close(model.scoreDay(day, targets).score, testCase.dayScores[dayIndex], 1e-9, `case ${caseIndex} day ${dayIndex} score`);
  });
  const features = model.weeklyFeatures(testCase.days, targets);
  features.forEach((value, index) => close(value, testCase.features[index], 1e-9, `case ${caseIndex} ${model.FEATURE_NAMES[index]}`));
  const cluster = model.assignCluster(features);
  assert.strictEqual(cluster.id, testCase.cluster, `case ${caseIndex} cluster`);
  checks += 1;
  close(model.riskProbability(features), testCase.riskProbability, 1e-5, `case ${caseIndex} risk probability`);
});

// Targets: Mifflin-St Jeor worked example (female, 21 y, 60 kg, 165 cm, 20 active min/day)
const targets = model.computeTargets({ age: 21, weight: 60, height: 165, sex: 'female', averageActiveMinutes: 20 });
// BMR = 10*60 + 6.25*165 - 5*21 - 161 = 1365.25; x 1.55 = 2116.1
assert.strictEqual(targets.calories, 2116);
assert.strictEqual(targets.protein, 48);
assert.strictEqual(targets.sugarLimit, 53);
checks += 3;

console.log(`Diet ML parity: ${checks} checks passed across ${models.parity.length} cases (${models.risk.label}, k=${models.clustering.k}).`);
