// Diet monitoring page: food + activity logging and the ML insights.
const $ = (id) => document.getElementById(id);
const dietStatus = $('diet-status');
const mealForm = $('dm-meal-form');
const foodSearch = $('dm-food-search');
const foodList = $('dm-food-list');
const foodPreview = $('dm-food-preview');
const servingsInput = $('dm-servings');
const activityForm = $('dm-activity-form');
const minutesInput = $('dm-minutes');
const profileCard = $('dm-profile-card');
const profileForm = $('dm-profile-form');
const goalSelect = $('diet-goal');
const activityDialog = $('diet-activity-dialog');
const fitbitStatus = $('fitbit-status');
const fitbitConnectButton = $('fitbit-connect');
const fitbitDisconnectButton = $('fitbit-disconnect');

const ACTIVITY_REMINDER_INTERVAL_MS = 60 * 60 * 1000;
const ACTIVITY_REMINDER_STORAGE_KEY = 'dietActivityReminderLastShown';
const SLOT_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', supper: 'Supper', snack: 'Snacks & drinks', late: 'Late night' };
const SCORE_PARTS = [
  ['energy', 'Energy close to your needs', 25],
  ['protein', 'Protein', 20],
  ['fiber', 'Fibre', 15],
  ['sugar', 'Sugar under the limit', 15],
  ['fat', 'Fat under 35% of energy', 10],
  ['regularity', 'Regular meals + breakfast', 10],
  ['activity', 'Active minutes', 5]
];
const ACTIVITY_LABELS = { walking: 'Walking', running: 'Running', sport: 'Sport', gym: 'Gym', dancing: 'Dancing', cycling: 'Cycling', other: 'Activity' };

let dietData = null;
let foodSource = 'menu';
let lastActivityReminderAt = Date.now();
let activityReminderStorageKey = ACTIVITY_REMINDER_STORAGE_KEY;
let profileDismissed = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showDietStatus(message, isError = false) {
  dietStatus.textContent = message;
  dietStatus.classList.toggle('is-error', isError);
  dietStatus.classList.toggle('is-success', !isError && Boolean(message));
  if (message && !isError) {
    clearTimeout(showDietStatus.timer);
    showDietStatus.timer = setTimeout(() => {
      if (dietStatus.textContent === message) {
        dietStatus.textContent = '';
        dietStatus.classList.remove('is-success');
      }
    }, 5000);
  }
}

async function requestDietApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('The diet service is not available right now. Please refresh the page in a moment.');
  }
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.location.href = 'login.html';
    throw new Error(result.message || 'The request could not be completed.');
  }
  return result;
}

function scoreTone(score) {
  if (score === null || score === undefined) return 'none';
  if (score >= 70) return 'good';
  if (score >= 55) return 'ok';
  return 'low';
}

function checkedValue(name) {
  const input = document.querySelector(`input[name="${name}"]:checked`);
  return input ? input.value : '';
}

// ---------------------------------------------------------------------------
// Hero: score ring + chips
// ---------------------------------------------------------------------------
function renderHero(data) {
  const ring = $('dm-ring');
  const score = data.today.score ? data.today.score.score : null;
  ring.style.setProperty('--value', score === null ? 0 : score);
  ring.dataset.tone = scoreTone(score);
  ring.setAttribute('aria-label', score === null ? "Today's diet score: not started" : `Today's diet score: ${Math.round(score)} out of 100`);
  $('dm-ring-value').textContent = score === null ? '—' : Math.round(score);
  const loggedItems = data.today.meals.length;
  $('dm-ring-note').textContent = score === null
    ? 'Log a meal to start today\'s score.'
    : loggedItems
      ? `So far today, from ${loggedItems} item${loggedItems === 1 ? '' : 's'}. It updates as you log.`
      : 'From your activity so far. Log meals to complete it.';

  const chips = [];
  if (data.insight.ready && data.insight.cluster) {
    chips.push(`<span class="dm-chip dm-chip--pattern">${escapeHtml(data.insight.cluster.name)}</span>`);
  }
  if (data.insight.ready && data.insight.risk) {
    const level = data.insight.risk.level;
    const label = level === 'high' ? 'High risk next week' : level === 'medium' ? 'Some risk next week' : 'Low risk next week';
    chips.push(`<span class="dm-chip dm-chip--risk-${escapeHtml(level)}">${label}</span>`);
  }
  const loggedDays = data.week.filter((day) => day.logged).length;
  chips.push(`<span class="dm-chip">${loggedDays} of 7 days logged</span>`);
  $('dm-hero-chips').innerHTML = chips.join('');
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
function renderProfile(data) {
  const profile = data.profile;
  $('dm-age').value = profile.age ?? '';
  $('dm-weight').value = profile.weight ?? '';
  $('dm-height').value = profile.height ?? '';
  document.querySelectorAll('input[name="dm-sex"]').forEach((input) => { input.checked = input.value === profile.sex; });
  if (!profile.complete) {
    profileCard.hidden = false;
    $('dm-profile-close').hidden = true;
    $('dm-profile-title').textContent = 'Set up your personal targets';
    $('dm-profile-help').textContent = 'Add your sex and check your details so your energy and protein targets fit you. Until then we use a general 2,200 kcal target.';
  } else if (!profileDismissed && profileCard.dataset.editing !== 'true') {
    profileCard.hidden = true;
  }
}

function openProfileEditor() {
  profileCard.hidden = false;
  profileCard.dataset.editing = 'true';
  $('dm-profile-close').hidden = !dietData || !dietData.profile.complete;
  $('dm-profile-title').textContent = 'Edit your body profile';
  $('dm-profile-help').textContent = 'Targets use the Mifflin-St Jeor equation with your activity from the last 7 days.';
  profileCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('dm-age').focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// Targets + score breakdown
// ---------------------------------------------------------------------------
function targetRow({ label, value, target, unit, limit = false, decimals = 0, note = '' }) {
  const ratio = target > 0 ? value / target : 0;
  const percent = Math.min(100, Math.round(ratio * 100));
  let tone = 'progress';
  if (limit) tone = ratio > 1 ? 'over' : 'ok';
  else if (ratio >= 0.9) tone = 'done';
  const right = limit
    ? `${formatNumber(value, decimals)} / ${formatNumber(target)} ${unit} limit`
    : `${formatNumber(value, decimals)} / ${formatNumber(target)} ${unit}`;
  return `
    <div class="dm-target" data-tone="${tone}">
      <div class="dm-target-top">
        <strong>${label}</strong>
        <span>${right}</span>
      </div>
      <div class="dm-bar" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div>
      ${note ? `<small>${note}</small>` : ''}
    </div>`;
}

function renderTargets(data) {
  const totals = data.today.totals;
  const targets = data.targets;
  const fatPct = totals.calories > 0 ? Math.round((totals.fat * 9 / totals.calories) * 100) : 0;
  $('dm-targets').innerHTML = [
    targetRow({
      label: 'Energy', value: totals.calories, target: targets.calories, unit: 'kcal',
      note: targets.complete
        ? `Your needs: ${formatNumber(targets.bmr)} kcal at rest × ${targets.activityFactor} activity factor`
        : 'General target. Complete your body profile for a personal one.'
    }),
    targetRow({ label: 'Protein', value: totals.protein, target: targets.protein, unit: 'g', decimals: 1 }),
    targetRow({ label: 'Fibre', value: totals.fiber, target: targets.fiber, unit: 'g', decimals: 1 }),
    targetRow({ label: 'Sugar', value: totals.sugar, target: targets.sugarLimit, unit: 'g', limit: true, decimals: 1,
      note: totals.sugar > targets.sugarLimit ? 'Over the WHO limit (10% of energy). Swap a soft drink for water.' : '' }),
    targetRow({ label: 'Active minutes', value: totals.activeMinutes, target: targets.activityMinutes, unit: 'min' }),
    `<p class="dm-muted dm-small dm-fat-line">Fat: ${formatNumber(totals.fat, 1)} g · ${fatPct}% of energy (aim for under 35%)</p>`
  ].join('');

  const parts = data.today.score ? data.today.score.parts : null;
  $('dm-score-parts').innerHTML = SCORE_PARTS.map(([key, label, max]) => {
    const value = parts ? parts[key] : 0;
    return `
      <div class="dm-part">
        <span>${label}</span>
        <div class="dm-bar dm-bar--thin"><span style="width:${Math.round((value / max) * 100)}%"></span></div>
        <b>${formatNumber(value, 1)} / ${max}</b>
      </div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// ML insight
// ---------------------------------------------------------------------------
function renderInsight(data) {
  const body = $('dm-insight-body');
  const insight = data.insight;
  if (!data.model.loaded) {
    body.innerHTML = '<p class="dm-muted">The diet models are not loaded on the server yet.</p>';
    return;
  }
  if (!insight.ready) {
    const have = Math.min(insight.loggedDays, insight.neededDays);
    body.innerHTML = `
      <div class="dm-unlock">
        <div class="dm-unlock-dots" aria-hidden="true">
          ${Array.from({ length: insight.neededDays }, (_, index) => `<span class="${index < have ? 'is-done' : ''}"></span>`).join('')}
        </div>
        <strong>Log food on ${insight.neededDays} days to unlock your insight</strong>
        <p>You have food logged on ${insight.loggedDays} of the last 7 days (today is not counted until it is over). After ${insight.neededDays} days the AI will show your eating pattern and warn you early if your diet is heading the wrong way.</p>
      </div>`;
    return;
  }

  const cluster = insight.cluster;
  const risk = insight.risk;
  const percent = Math.round(risk.probability * 100);
  const levelText = risk.level === 'high' ? 'High' : risk.level === 'medium' ? 'Medium' : 'Low';
  body.innerHTML = `
    <div class="dm-pattern">
      <span class="dm-pattern-label">Your pattern this week</span>
      <strong class="dm-pattern-name">${escapeHtml(cluster.name)}</strong>
      <p>${escapeHtml(cluster.description)}</p>
      <p class="dm-tip">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>
        ${escapeHtml(cluster.tip)}
      </p>
    </div>
    <div class="dm-risk" data-level="${escapeHtml(risk.level)}">
      <div class="dm-risk-top">
        <span>Risk of a poor diet next week</span>
        <strong>${levelText} · ${percent}%</strong>
      </div>
      <div class="dm-bar dm-bar--risk"><span style="width:${percent}%"></span></div>
      ${risk.reasons.length ? `
        <p class="dm-risk-why">${risk.level === 'low' ? 'Things to keep an eye on:' : 'Why:'}</p>
        <ul class="dm-risk-reasons">${risk.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>`
        : '<p class="dm-risk-why">Nothing worrying in your last 7 days. Keep it up!</p>'}
    </div>
    <p class="dm-muted dm-small">Pattern from a K-means model; risk from a ${escapeHtml(data.model.risk.algorithm)} model. Both use your last 7 days.</p>`;
}

// ---------------------------------------------------------------------------
// Food search
// ---------------------------------------------------------------------------
function currentFoods() {
  if (!dietData) return [];
  return foodSource === 'menu'
    ? dietData.foods.map((food) => ({ ...food, key: `menu:${food.id}`, label: food.name }))
    : dietData.outsideFoods.map((food) => ({ ...food, key: `outside:${food.key}`, label: food.name }));
}

function renderFoodList() {
  foodList.innerHTML = currentFoods().map((food) => `<option value="${escapeHtml(food.label)}"></option>`).join('');
  $('dm-food-label').textContent = foodSource === 'menu' ? 'Search the menu' : 'Search common foods';
  foodSearch.placeholder = foodSource === 'menu' ? 'Type a food, e.g. rice' : 'Type a food, e.g. bread';
}

function selectedFood() {
  const text = foodSearch.value.trim().toLowerCase();
  if (!text) return null;
  return currentFoods().find((food) => food.label.toLowerCase() === text) || null;
}

function updateFoodPreview() {
  const food = selectedFood();
  if (!food) {
    foodPreview.innerHTML = foodSearch.value.trim()
      ? 'Pick a food from the list as you type.'
      : 'Choose a food to see its nutrition.';
    foodPreview.classList.remove('has-food');
    return;
  }
  const servings = Number(servingsInput.value) || 1;
  foodPreview.classList.add('has-food');
  foodPreview.innerHTML = `
    <div class="dm-preview-grid">
      <span><b>${formatNumber(food.calories * servings)}</b> kcal</span>
      <span><b>${formatNumber(food.protein * servings, 1)}</b> g protein</span>
      <span><b>${formatNumber(food.fiber * servings, 1)}</b> g fibre</span>
      <span class="${food.sugar * servings > 20 ? 'is-warn' : ''}"><b>${formatNumber(food.sugar * servings, 1)}</b> g sugar</span>
    </div>
    <small>${escapeHtml(food.estimateType === 'standard portion' ? 'Standard portion' : `Estimated from: ${food.components.join(' + ')}`)}</small>`;
}

function setFoodSource(source) {
  foodSource = source;
  document.querySelectorAll('.dm-tab').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.source === source)));
  foodSearch.value = '';
  renderFoodList();
  updateFoodPreview();
}

// ---------------------------------------------------------------------------
// Diary
// ---------------------------------------------------------------------------
function renderDiary(data) {
  const meals = data.today.meals;
  const activities = data.today.activities;
  if (!meals.length && !activities.length) {
    $('dm-diary').innerHTML = `
      <div class="dm-empty">
        <strong>Nothing logged yet today</strong>
        <span>Collected orders appear here automatically. Add breakfast, snacks or food from home with the form.</span>
      </div>`;
    return;
  }
  const groups = ['breakfast', 'lunch', 'supper', 'snack', 'late']
    .map((slot) => ({ slot, items: meals.filter((meal) => meal.slot === slot) }))
    .filter((group) => group.items.length);
  const html = groups.map((group) => `
    <div class="dm-diary-group">
      <h4>${SLOT_LABELS[group.slot]} <span>${formatNumber(group.items.reduce((sum, item) => sum + item.calories, 0))} kcal</span></h4>
      ${group.items.map((meal) => `
        <div class="dm-diary-item">
          <div>
            <strong>${escapeHtml(meal.foodName)}${meal.servings !== 1 ? ` <em>× ${formatNumber(meal.servings, 1)}</em>` : ''}</strong>
            <span>${meal.time}${meal.source === 'order' ? ' · <span class="dm-order-tag">From your order</span>' : ''} · ${formatNumber(meal.protein, 1)} g protein · ${formatNumber(meal.sugar, 1)} g sugar</span>
          </div>
          <b>${formatNumber(meal.calories)} kcal</b>
          <button type="button" class="dm-remove" data-remove-meal="${meal.id}" aria-label="Remove ${escapeHtml(meal.foodName)}">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>`).join('')}
    </div>`).join('');
  const activityHtml = activities.length ? `
    <div class="dm-diary-group dm-diary-group--activity">
      <h4>Activity <span>${formatNumber(data.today.totals.activeMinutes)} active min</span></h4>
      ${activities.map((activity) => `
        <div class="dm-diary-item">
          <div>
            <strong>${escapeHtml(ACTIVITY_LABELS[activity.type] || 'Activity')} · ${activity.minutes} min</strong>
            <span>${activity.time} · ${escapeHtml(activity.intensity)}</span>
          </div>
          <b></b>
          <button type="button" class="dm-remove" data-remove-activity="${activity.id}" aria-label="Remove activity">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>`).join('')}
    </div>` : '';
  $('dm-diary').innerHTML = html + activityHtml;
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------
function renderRecommendations(data) {
  $('dm-recs-model').textContent = `${data.recommendationModel.name}. ${data.recommendationModel.trainingHint}`;
  if (!data.recommendations.length) {
    $('dm-recs').innerHTML = '<div class="dm-empty"><strong>No suggestions right now</strong><span>Check back when the menu is updated.</span></div>';
    return;
  }
  $('dm-recs').innerHTML = data.recommendations.map((food, index) => `
    <article class="dm-rec">
      <span class="dm-rec-rank">${index + 1}</span>
      <div class="dm-rec-body">
        <div class="dm-rec-top">
          <strong>${escapeHtml(food.name)}</strong>
          <span class="dm-rec-score" title="Match score">${food.score}% match</span>
        </div>
        <p>${escapeHtml(food.reason)}</p>
        <span class="dm-muted dm-small">${formatNumber(food.calories)} kcal · ${formatNumber(food.protein, 1)} g protein · ${formatNumber(food.fiber, 1)} g fibre · ${formatNumber(food.sugar, 1)} g sugar</span>
        <div class="dm-rec-actions">
          <a class="dm-link-button" href="home.html#menu">Order</a>
          <button type="button" class="dm-feedback" data-food-id="${food.id}" data-rating="1" aria-label="Helpful suggestion">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11v9H4v-9h3zM7 11l4-8c1.7 0 3 1.3 3 3v3h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7"/></svg> Helpful
          </button>
          <button type="button" class="dm-feedback" data-food-id="${food.id}" data-rating="-1" aria-label="Not helpful suggestion">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 13V4h3v9h-3zM17 13l-4 8c-1.7 0-3-1.3-3-3v-3H5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.2 4H17"/></svg> Not for me
          </button>
        </div>
      </div>
    </article>`).join('');
}

// ---------------------------------------------------------------------------
// Week chart
// ---------------------------------------------------------------------------
function renderWeek(data) {
  $('dm-week').innerHTML = data.week.map((day) => {
    const date = new Date(`${day.date}T12:00:00`);
    const label = day.isToday ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'short' });
    const height = day.score === null ? 6 : Math.max(8, Math.round(day.score));
    const tone = scoreTone(day.score);
    return `
      <div class="dm-week-day${day.isToday ? ' is-today' : ''}" data-tone="${tone}">
        <span class="dm-week-value">${day.score === null ? '—' : Math.round(day.score)}</span>
        <div class="dm-week-track"><span style="height:${height}%"></span></div>
        <strong>${label}</strong>
        <small>${day.logged ? `${formatNumber(day.calories)} kcal` : 'not logged'}</small>
      </div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------
function renderHow(data) {
  const model = data.model;
  if (!model.loaded) {
    $('dm-how-body').innerHTML = '<p class="dm-muted">Models not loaded.</p>';
    return;
  }
  const risk = model.risk.metrics;
  const trained = new Date(model.trainedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  $('dm-how-body').innerHTML = `
    <ol class="dm-steps">
      <li><strong>Collect</strong><span>Collected orders are added to your diary automatically. You add other food and your activity.</span></li>
      <li><strong>Score</strong><span>Each day gets a 0–100 diet score against your personal targets (Mifflin-St Jeor energy needs and WHO guidance).</span></li>
      <li><strong>Pattern (Model A)</strong><span>A K-means clustering model groups your last 7 days into one of ${model.clustering.k} eating patterns (silhouette ${model.clustering.silhouette}).</span></li>
      <li><strong>Early warning (Model B)</strong><span>A ${escapeHtml(model.risk.algorithm)} model predicts whether your average score will fall below 55 over the next 7 days. On students it had never seen: ${Math.round(risk.accuracy * 100)}% accuracy, ROC AUC ${risk.rocAuc}.</span></li>
      <li><strong>Suggest (Model C)</strong><span>Menu items are ranked by how well they fill today's gaps, what you rate helpful (a personal logistic regression) and what students with the same pattern buy.</span></li>
    </ol>
    <p class="dm-muted dm-small">Models trained in Python (scikit-learn) on ${formatNumber(model.dataset.studentDays)} simulated student-days (${model.dataset.students} students × ${model.dataset.days} days) on ${trained}. They will be retrained on real diaries as the app is used.</p>`;
}

// ---------------------------------------------------------------------------
// Load + render
// ---------------------------------------------------------------------------
function renderAll(data) {
  dietData = data;
  goalSelect.value = data.goal;
  renderHero(data);
  renderProfile(data);
  renderTargets(data);
  renderInsight(data);
  renderFoodList();
  updateFoodPreview();
  renderDiary(data);
  renderRecommendations(data);
  renderWeek(data);
  renderHow(data);
  if (!checkedValue('dm-slot')) {
    const slotInput = document.querySelector(`input[name="dm-slot"][value="${data.currentSlot}"]`);
    if (slotInput) slotInput.checked = true;
  }
}

async function loadDietData() {
  renderAll(await requestDietApi('/api/diet'));
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
document.querySelectorAll('.dm-tab').forEach((tab) => {
  tab.addEventListener('click', () => setFoodSource(tab.dataset.source));
});
foodSearch.addEventListener('input', updateFoodPreview);
servingsInput.addEventListener('input', updateFoodPreview);
document.querySelectorAll('.dm-stepper button').forEach((button) => {
  button.addEventListener('click', () => {
    const next = Math.min(5, Math.max(0.5, (Number(servingsInput.value) || 1) + Number(button.dataset.step)));
    servingsInput.value = next;
    updateFoodPreview();
  });
});

mealForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const food = selectedFood();
  if (!food) {
    showDietStatus('Choose a food from the list as you type.', true);
    foodSearch.focus();
    return;
  }
  const slot = checkedValue('dm-slot');
  if (!slot) {
    showDietStatus('Choose which meal this was.', true);
    return;
  }
  const button = mealForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const payload = {
      servings: Number(servingsInput.value),
      slot,
      day: checkedValue('dm-meal-day') || 'today'
    };
    if (foodSource === 'menu') payload.menuItemId = Number(food.id);
    else payload.foodKey = food.key.replace('outside:', '');
    const result = await requestDietApi('/api/diet/meals', { method: 'POST', body: JSON.stringify(payload) });
    foodSearch.value = '';
    servingsInput.value = 1;
    await loadDietData();
    showDietStatus(result.message);
  } catch (error) {
    showDietStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$('dm-minute-chips').addEventListener('click', (event) => {
  const chip = event.target.closest('button[data-minutes]');
  if (!chip) return;
  minutesInput.value = chip.dataset.minutes;
  document.querySelectorAll('#dm-minute-chips button').forEach((button) => button.classList.toggle('is-selected', button === chip));
});
minutesInput.addEventListener('input', () => {
  document.querySelectorAll('#dm-minute-chips button').forEach((button) => button.classList.toggle('is-selected', button.dataset.minutes === minutesInput.value));
});

async function saveActivity(payload, button) {
  if (button) button.disabled = true;
  try {
    const result = await requestDietApi('/api/diet/activity', { method: 'POST', body: JSON.stringify(payload) });
    await loadDietData();
    showDietStatus(result.message);
    return true;
  } catch (error) {
    showDietStatus(error.message, true);
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

activityForm.addEventListener('submit', (event) => {
  event.preventDefault();
  saveActivity({
    minutes: Math.round(Number(minutesInput.value)),
    intensity: checkedValue('dm-intensity') || 'moderate',
    type: $('dm-activity-type').value,
    day: checkedValue('dm-activity-day') || 'today'
  }, activityForm.querySelector('button[type="submit"]'));
});

$('dm-diary').addEventListener('click', async (event) => {
  const mealButton = event.target.closest('[data-remove-meal]');
  const activityButton = event.target.closest('[data-remove-activity]');
  if (!mealButton && !activityButton) return;
  const button = mealButton || activityButton;
  button.disabled = true;
  try {
    const url = mealButton ? `/api/diet/meals/${mealButton.dataset.removeMeal}` : `/api/diet/activity/${activityButton.dataset.removeActivity}`;
    const result = await requestDietApi(url, { method: 'DELETE' });
    await loadDietData();
    showDietStatus(result.message);
  } catch (error) {
    showDietStatus(error.message, true);
    button.disabled = false;
  }
});

$('dm-recs').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-food-id][data-rating]');
  if (!button) return;
  button.disabled = true;
  try {
    const result = await requestDietApi('/api/diet/feedback', {
      method: 'POST',
      body: JSON.stringify({ menuItemId: Number(button.dataset.foodId), rating: Number(button.dataset.rating) })
    });
    await loadDietData();
    showDietStatus(result.message);
  } catch (error) {
    showDietStatus(error.message, true);
    button.disabled = false;
  }
});

goalSelect.addEventListener('change', async () => {
  try {
    const result = await requestDietApi('/api/diet/goal', { method: 'PUT', body: JSON.stringify({ goal: goalSelect.value }) });
    await loadDietData();
    showDietStatus(result.message);
  } catch (error) {
    showDietStatus(error.message, true);
  }
});

$('dm-profile-edit').addEventListener('click', openProfileEditor);
$('dm-profile-close').addEventListener('click', () => {
  profileCard.hidden = true;
  profileCard.dataset.editing = 'false';
  profileDismissed = true;
});
profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = profileForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await requestDietApi('/api/diet/profile', {
      method: 'PUT',
      body: JSON.stringify({
        age: Number($('dm-age').value),
        weight: Number($('dm-weight').value),
        height: Number($('dm-height').value),
        sex: checkedValue('dm-sex')
      })
    });
    profileCard.dataset.editing = 'false';
    profileCard.hidden = true;
    await loadDietData();
    showDietStatus(result.message);
  } catch (error) {
    showDietStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Hourly activity check-in
// ---------------------------------------------------------------------------
function initializeActivityReminder() {
  const now = Date.now();
  try {
    const user = JSON.parse(localStorage.getItem('foodieUser') || 'null');
    const userId = Number(user && user.id);
    if (Number.isSafeInteger(userId) && userId > 0) activityReminderStorageKey = `${ACTIVITY_REMINDER_STORAGE_KEY}:${userId}`;
    const stored = Number(localStorage.getItem(activityReminderStorageKey));
    lastActivityReminderAt = Number.isFinite(stored) && stored > 0 && stored <= now ? stored : now;
    localStorage.setItem(activityReminderStorageKey, String(lastActivityReminderAt));
  } catch {
    lastActivityReminderAt = now;
  }
}

function showActivityReminderIfDue() {
  if (activityDialog.open || Date.now() - lastActivityReminderAt < ACTIVITY_REMINDER_INTERVAL_MS) return;
  lastActivityReminderAt = Date.now();
  try {
    localStorage.setItem(activityReminderStorageKey, String(lastActivityReminderAt));
  } catch {
    // Reminder still works while the page is open.
  }
  $('dm-dialog-quick').hidden = true;
  $('dm-dialog-actions').hidden = false;
  activityDialog.showModal();
}

activityDialog.addEventListener('click', async (event) => {
  const answer = event.target.closest('button[data-activity-answer]');
  if (answer) {
    if (answer.dataset.activityAnswer === 'yes') {
      $('dm-dialog-actions').hidden = true;
      $('dm-dialog-quick').hidden = false;
      $('dm-dialog-quick').querySelector('button').focus();
    } else {
      activityDialog.close();
      showDietStatus('No problem. A 10-minute walk between lectures is a great start.');
    }
    return;
  }
  const quick = event.target.closest('button[data-quick-minutes]');
  if (quick) {
    activityDialog.close();
    await saveActivity({ minutes: Number(quick.dataset.quickMinutes), intensity: 'moderate', type: 'walking', day: 'today' });
  }
});

// ---------------------------------------------------------------------------
// Fitbit (optional)
// ---------------------------------------------------------------------------
async function loadFitbitData() {
  fitbitConnectButton.disabled = true;
  fitbitDisconnectButton.hidden = true;
  try {
    const data = await requestDietApi('/api/diet/fitbit/data');
    if (!data.configured) {
      fitbitStatus.textContent = 'Fitbit is not set up on this server. Log activity with the form above instead.';
      fitbitConnectButton.hidden = true;
      return;
    }
    if (!data.connected) {
      fitbitStatus.textContent = 'Connect a Fitbit to see your steps and resting heart rate.';
      fitbitConnectButton.hidden = false;
      return;
    }
    $('fitbit-steps').textContent = data.steps === null ? 'n/a' : Number(data.steps).toLocaleString();
    $('fitbit-heart-rate').textContent = data.restingHeartRate === null ? 'n/a' : `${Number(data.restingHeartRate)} bpm`;
    $('fitbit-date').textContent = data.date ? `Fitbit summary for ${data.date}` : '';
    fitbitStatus.textContent = 'Fitbit connected.';
    fitbitConnectButton.hidden = true;
    fitbitDisconnectButton.hidden = false;
  } catch (error) {
    fitbitStatus.textContent = error.message;
  } finally {
    fitbitConnectButton.disabled = false;
  }
}

fitbitConnectButton.addEventListener('click', async () => {
  fitbitConnectButton.disabled = true;
  fitbitStatus.textContent = 'Opening Fitbit…';
  try {
    const result = await requestDietApi('/api/diet/fitbit/connect');
    window.location.assign(result.authorizationUrl);
  } catch (error) {
    fitbitStatus.textContent = error.message;
    fitbitConnectButton.disabled = false;
  }
});

fitbitDisconnectButton.addEventListener('click', async () => {
  fitbitDisconnectButton.disabled = true;
  try {
    const result = await requestDietApi('/api/diet/fitbit/connection', { method: 'DELETE' });
    $('fitbit-steps').textContent = '—';
    $('fitbit-heart-rate').textContent = '—';
    $('fitbit-date').textContent = '';
    fitbitStatus.textContent = result.message;
    fitbitDisconnectButton.hidden = true;
    fitbitConnectButton.hidden = false;
  } catch (error) {
    fitbitStatus.textContent = error.message;
  } finally {
    fitbitDisconnectButton.disabled = false;
  }
});

$('diet-logout').addEventListener('click', async () => {
  try {
    await requestDietApi('/api/auth/logout', { method: 'POST' });
    localStorage.removeItem('foodieUser');
    window.location.href = 'login.html';
  } catch (error) {
    showDietStatus(error.message, true);
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
initializeActivityReminder();
const fitbitCallbackResult = new URLSearchParams(window.location.search).get('fitbit');
if (fitbitCallbackResult) {
  const messages = {
    connected: 'Fitbit connected successfully.',
    denied: 'Fitbit connection was cancelled.',
    failed: 'Fitbit could not be connected. Please try again.',
    'invalid-state': 'Fitbit connection expired. Please try again.',
    'not-configured': 'Fitbit is not configured on this server yet.'
  };
  showDietStatus(messages[fitbitCallbackResult] || messages.failed, fitbitCallbackResult !== 'connected');
  window.history.replaceState({}, document.title, window.location.pathname);
}
loadFitbitData();
setInterval(showActivityReminderIfDue, 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    showActivityReminderIfDue();
    loadDietData().catch(() => {});
  }
});
loadDietData().catch((error) => showDietStatus(error.message, true));
