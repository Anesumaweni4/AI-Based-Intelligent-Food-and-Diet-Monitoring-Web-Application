const dietStatus = document.getElementById('diet-status');
const dietGoalForm = document.getElementById('diet-goal-form');
const dietGoalSelect = document.getElementById('diet-goal');
const dietMealForm = document.getElementById('diet-meal-form');
const dietFoodSelect = document.getElementById('diet-food');
const dietServingsInput = document.getElementById('diet-servings');
const dietFoodNutrition = document.getElementById('diet-food-nutrition');
const dietTotals = document.getElementById('diet-totals');
const dietMeals = document.getElementById('diet-meals');
const dietWeek = document.getElementById('diet-week');
const dietRecommendations = document.getElementById('diet-recommendations');
const dietModelDescription = document.getElementById('diet-model-description');
const dietActivityDialog = document.getElementById('diet-activity-dialog');
const dietInsightsDialog = document.getElementById('diet-insights-dialog');
const dietOrderIdeasList = document.getElementById('diet-order-ideas-list');
const ACTIVITY_REMINDER_INTERVAL_MS = 60 * 60 * 1000;
const ACTIVITY_REMINDER_STORAGE_KEY = 'dietActivityReminderLastShown';
let dietData = null;
let lastActivityReminderAt;
let activityReminderStorageKey = ACTIVITY_REMINDER_STORAGE_KEY;

function initializeActivityReminder() {
  const now = Date.now();
  try {
    const user = JSON.parse(localStorage.getItem('foodieUser') || 'null');
    const userId = Number(user && user.id);
    if (Number.isSafeInteger(userId) && userId > 0) {
      activityReminderStorageKey = `${ACTIVITY_REMINDER_STORAGE_KEY}:${userId}`;
    }
    const storedTime = localStorage.getItem(activityReminderStorageKey);
    const parsedTime = storedTime === null ? now : Number(storedTime);
    lastActivityReminderAt = Number.isFinite(parsedTime) && parsedTime > 0 && parsedTime <= now
      ? parsedTime
      : now;
    if (storedTime === null || lastActivityReminderAt !== parsedTime) {
      localStorage.setItem(activityReminderStorageKey, String(lastActivityReminderAt));
    }
  } catch (error) {
    console.error('Unable to persist the diet activity reminder time:', error);
    lastActivityReminderAt = now;
    showDietStatus('Hourly reminders will work while this page stays open, but may restart if you reload.', true);
  }
}

function showActivityReminderIfDue() {
  if (dietActivityDialog.open || Date.now() - lastActivityReminderAt < ACTIVITY_REMINDER_INTERVAL_MS) return;

  lastActivityReminderAt = Date.now();
  try {
    localStorage.setItem(activityReminderStorageKey, String(lastActivityReminderAt));
  } catch (error) {
    console.error('Unable to save the diet activity reminder time:', error);
  }
  dietActivityDialog.showModal();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function showDietStatus(message, isError = false) {
  dietStatus.textContent = message;
  dietStatus.classList.toggle('error', isError);
}

async function requestDietApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      'The running app needs to be restarted to load diet monitoring. Stop it in its terminal, then run npm.cmd start and refresh this page.'
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`The diet monitoring API returned invalid data (HTTP ${response.status}). Please restart the app and try again.`);
  }
  if (!response.ok) {
    if (response.status === 401) window.location.href = 'login.html';
    throw new Error(result.message || 'The diet monitoring request could not be completed.');
  }
  return result;
}

function formatAmount(value, suffix = '') {
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`;
}

function formatMealDate(value) {
  const normalized = String(value).replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatOrderDate(value) {
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
}

function renderFoodOptions() {
  const selectedId = dietFoodSelect.value;
  dietFoodSelect.innerHTML = '<option value="">Choose a menu item</option>' + dietData.foods.map((food) => `
    <option value="${escapeHtml(food.id)}">${escapeHtml(food.name)} (${escapeHtml(food.estimateType)})</option>
  `).join('');
  dietFoodSelect.disabled = dietData.foods.length === 0;
  if (!dietData.foods.length) {
    dietFoodSelect.innerHTML = '<option value="">No menu foods are available</option>';
  }
  if (dietData.foods.some((food) => String(food.id) === selectedId)) dietFoodSelect.value = selectedId;
  updateFoodEstimate();
}

function updateFoodEstimate() {
  if (!dietData) return;
  const food = dietData.foods.find((item) => String(item.id) === dietFoodSelect.value);
  if (!food) {
    dietFoodNutrition.textContent = 'Choose a food to see its estimated nutrition per serving.';
    return;
  }

  const servings = Number(dietServingsInput.value) || 1;
  dietFoodNutrition.textContent =
    `Per serving: ${formatAmount(food.calories * servings, ' kcal')} · ` +
    `${formatAmount(food.protein * servings, ' g')} protein · ` +
    `${formatAmount(food.fiber * servings, ' g')} fiber (${food.estimateType}).`;
}

function renderTotals(totals) {
  const values = [
    ['Calories', formatAmount(totals.calories, ' kcal')],
    ['Protein', formatAmount(totals.protein, ' g')],
    ['Carbohydrates', formatAmount(totals.carbohydrates, ' g')],
    ['Fat', formatAmount(totals.fat, ' g')],
    ['Fiber', formatAmount(totals.fiber, ' g')]
  ];
  dietTotals.innerHTML = values.map(([label, value]) => `
    <div class="diet-total-card">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join('');
}

function renderMeals(meals) {
  if (!meals.length) {
    dietMeals.innerHTML = '<p class="diet-empty">No meals logged today yet.</p>';
    return;
  }
  dietMeals.innerHTML = meals.map((meal) => `
    <article class="diet-list-item">
      <div>
        <strong>${escapeHtml(meal.food_name)}</strong>
        <span>${formatAmount(meal.servings, ' serving(s)')} · ${escapeHtml(formatMealDate(meal.eaten_at))}</span>
      </div>
      <b>${formatAmount(Number(meal.calories) * Number(meal.servings), ' kcal')}</b>
    </article>
  `).join('');
}

function renderWeek(week) {
  if (!week.length) {
    dietWeek.innerHTML = '<p class="diet-empty">Your recent meal pattern will appear here as you log meals.</p>';
    return;
  }
  const maxCalories = Math.max(...week.map((day) => Number(day.calories)), 1);
  dietWeek.innerHTML = week.map((day) => {
    const width = Math.max(4, Math.round(Number(day.calories) / maxCalories * 100));
    return `
      <div class="diet-week-item">
        <div class="diet-week-label">
          <strong>${escapeHtml(new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }))}</strong>
          <span>${formatAmount(day.calories, ' kcal')} · ${formatAmount(day.meals, ' serving(s)')}</span>
        </div>
        <div class="diet-week-track" aria-label="${formatAmount(day.calories, ' kilocalories')}">
          <span style="width: ${width}%"></span>
        </div>
      </div>
    `;
  }).join('');
}

function renderRecommendations(recommendations) {
  if (!recommendations.length) {
    dietRecommendations.innerHTML = '<p class="diet-empty">There are no menu items to recommend right now.</p>';
    return;
  }
  dietRecommendations.innerHTML = recommendations.map((food) => `
    <article class="diet-recommendation">
      <div class="diet-recommendation-heading">
        <div>
          <strong>${escapeHtml(food.name)}</strong>
          <span>${escapeHtml(food.category || 'Menu item')}</span>
        </div>
        <span class="diet-score" aria-label="Recommendation score">${escapeHtml(food.score)}%</span>
      </div>
      <p>${escapeHtml(food.reason)}</p>
      <div class="diet-recommendation-nutrition">
        ${formatAmount(food.calories, ' kcal')} · ${formatAmount(food.protein, ' g')} protein · ${formatAmount(food.fiber, ' g')} fiber
      </div>
      <div class="diet-feedback-actions">
        <button type="button" class="diet-feedback-button" data-food-id="${escapeHtml(food.id)}" data-rating="1">Helpful</button>
        <button type="button" class="diet-feedback-button" data-food-id="${escapeHtml(food.id)}" data-rating="-1">Not helpful</button>
      </div>
    </article>
  `).join('');
}

function renderDietData(data) {
  dietData = data;
  dietGoalSelect.value = data.goal;
  renderFoodOptions();
  renderTotals(data.totals);
  renderMeals(data.meals);
  renderWeek(data.weekly);
  renderRecommendations(data.recommendations);
  renderMealIdeas(data.mealIdeas);
  dietModelDescription.textContent =
    `${data.model.name} · ${data.model.feedbackCount} feedback record(s). ${data.model.trainingHint}`;
}

function renderMealIdeas(mealIdeas = []) {
  if (!mealIdeas.length) {
    dietOrderIdeasList.innerHTML = '<p class="diet-empty">No recent orders to use for meal ideas yet. Place an order and your familiar choices will appear here.</p>';
    return;
  }
  dietOrderIdeasList.innerHTML = mealIdeas.map((food) => `
    <article class="diet-order-idea">
      <div>
        <strong>${escapeHtml(food.name)}</strong>
        <span>${Number(food.purchaseCount)} serving(s) ordered · last ordered ${escapeHtml(formatOrderDate(food.lastOrderedAt))}</span>
      </div>
      <p>${escapeHtml(food.reason)}</p>
      <span>${formatAmount(food.calories, ' kcal')} · ${formatAmount(food.protein, ' g')} protein · ${formatAmount(food.fiber, ' g')} fiber per serving</span>
    </article>
  `).join('');
}

async function loadDietData() {
  const data = await requestDietApi('/api/diet');
  renderDietData(data);
}

dietGoalForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = dietGoalForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await requestDietApi('/api/diet/goal', {
      method: 'PUT',
      body: JSON.stringify({ goal: dietGoalSelect.value })
    });
    await loadDietData();
    showDietStatus(result.message);
  } catch (error) {
    showDietStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});

dietMealForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = dietMealForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await requestDietApi('/api/diet/meals', {
      method: 'POST',
      body: JSON.stringify({
        menuItemId: Number(dietFoodSelect.value),
        servings: Number(dietServingsInput.value)
      })
    });
    dietMealForm.reset();
    await loadDietData();
    showDietStatus(result.message);
  } catch (error) {
    showDietStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});

dietFoodSelect.addEventListener('change', updateFoodEstimate);
dietServingsInput.addEventListener('input', updateFoodEstimate);

document.getElementById('diet-insights-open').addEventListener('click', () => {
  dietInsightsDialog.showModal();
});
document.getElementById('diet-insights-close').addEventListener('click', () => {
  dietInsightsDialog.close();
});

dietRecommendations.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-food-id][data-rating]');
  if (!button) return;
  button.disabled = true;
  try {
    const result = await requestDietApi('/api/diet/feedback', {
      method: 'POST',
      body: JSON.stringify({
        menuItemId: Number(button.dataset.foodId),
        rating: Number(button.dataset.rating)
      })
    });
    await loadDietData();
    showDietStatus(result.message);
  } catch (error) {
    showDietStatus(error.message, true);
    button.disabled = false;
  }
});

dietActivityDialog.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-activity-answer]');
  if (!button) return;
  showDietStatus(button.dataset.activityAnswer === 'yes'
    ? 'Thanks for checking in with your activity today.'
    : 'That’s okay—take a movement break when it works for you.');
  dietActivityDialog.close();
});

document.getElementById('diet-logout').addEventListener('click', async (event) => {
  event.preventDefault();
  try {
    await requestDietApi('/api/auth/logout', { method: 'POST' });
    localStorage.removeItem('foodieUser');
    window.location.href = 'login.html';
  } catch (error) {
    showDietStatus(error.message, true);
  }
});

initializeActivityReminder();
showActivityReminderIfDue();
setInterval(showActivityReminderIfDue, 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) showActivityReminderIfDue();
});

loadDietData().catch((error) => {
  dietFoodSelect.innerHTML = '<option value="">Could not load menu — restart the app</option>';
  dietFoodSelect.disabled = true;
  dietFoodNutrition.textContent = 'The menu will appear after the diet API is available.';
  showDietStatus(error.message, true);
});
