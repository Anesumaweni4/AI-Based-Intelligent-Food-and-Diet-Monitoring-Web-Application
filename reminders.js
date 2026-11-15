// Free phone notifications for meal, water and exercise reminders.
//
// Uses the Web Push standard (no paid service, no app store): the browser on
// the student's phone gives us a "subscription" and we send short messages to
// it. Works on Android (Chrome, Edge, Firefox, Samsung Internet) and on iPhone
// (iOS 16.4+) once THE KITCHEN has been added to the Home Screen.
//
// Every minute the scheduler checks which reminders are due in Africa/Harare
// time. Each reminder is sent at most once a day, and only when it is still
// useful: no lunch reminder if lunch is already in the diary, no exercise
// nudge if today's active minutes are already reached.
const webpush = require('web-push');
const { get, all, run } = require('./db');
const dietService = require('./diet-service');

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const CATCH_UP_MINUTES = 60; // a reminder missed while the server slept is still sent within an hour
const WATER_TIMES = { 'water-am': '10:30', 'water-pm': '15:30' };
const DEFAULT_SETTINGS = {
  mealsEnabled: true,
  breakfastTime: '07:30',
  lunchTime: '13:00',
  supperTime: '18:30',
  exerciseEnabled: true,
  exerciseTime: '17:00',
  waterEnabled: true
};

// ---------------------------------------------------------------------------
// Server push keys (VAPID). Taken from the environment when set, otherwise
// created once and kept in the database so subscriptions survive restarts.
// ---------------------------------------------------------------------------
let vapidKeys = null;

async function readSetting(key) {
  const row = await get('SELECT setting_value FROM app_settings WHERE setting_key = ?', [key]);
  return row ? row.setting_value : null;
}

async function ensureVapidKeys() {
  if (vapidKeys) return vapidKeys;
  let publicKey = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    publicKey = await readSetting('vapid_public_key');
    privateKey = await readSetting('vapid_private_key');
    if (!publicKey || !privateKey) {
      const generated = webpush.generateVAPIDKeys();
      await run('DELETE FROM app_settings WHERE setting_key IN (?, ?)', ['vapid_public_key', 'vapid_private_key']);
      await run('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)', ['vapid_public_key', generated.publicKey]);
      await run('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)', ['vapid_private_key', generated.privateKey]);
      // Another server instance may have written its keys first: use whatever is stored.
      publicKey = await readSetting('vapid_public_key');
      privateKey = await readSetting('vapid_private_key');
    }
  }
  const subject = process.env.VAPID_SUBJECT
    || (process.env.APP_BASE_URL && /^https:\/\//.test(process.env.APP_BASE_URL) ? process.env.APP_BASE_URL : 'mailto:reminders@thekitchen.app');
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidKeys = { publicKey, privateKey };
  return vapidKeys;
}

// ---------------------------------------------------------------------------
// Settings and subscriptions
// ---------------------------------------------------------------------------
const flag = (value) => value === true || Number(value) === 1;

function rowToSettings(row) {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    mealsEnabled: flag(row.meals_enabled),
    breakfastTime: row.breakfast_time,
    lunchTime: row.lunch_time,
    supperTime: row.supper_time,
    exerciseEnabled: flag(row.exercise_enabled),
    exerciseTime: row.exercise_time,
    waterEnabled: flag(row.water_enabled)
  };
}

async function getSettings(userId) {
  const row = await get('SELECT * FROM reminder_settings WHERE user_id = ?', [userId]);
  return rowToSettings(row);
}

function parseSettings(body, current) {
  const next = { ...current };
  const errors = [];
  for (const key of ['mealsEnabled', 'exerciseEnabled', 'waterEnabled']) {
    if (body[key] !== undefined) next[key] = Boolean(body[key]);
  }
  for (const key of ['breakfastTime', 'lunchTime', 'supperTime', 'exerciseTime']) {
    if (body[key] === undefined) continue;
    const value = String(body[key]).trim().slice(0, 5);
    if (!TIME_PATTERN.test(value)) errors.push(key);
    else next[key] = value;
  }
  if (errors.length) return { error: 'Please choose a valid time (HH:MM).' };
  const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  if (!(minutes(next.breakfastTime) < minutes(next.lunchTime) && minutes(next.lunchTime) < minutes(next.supperTime))) {
    return { error: 'Breakfast must be before lunch, and lunch before supper.' };
  }
  return { settings: next };
}

async function saveSettings(userId, body) {
  const parsed = parseSettings(body || {}, await getSettings(userId));
  if (parsed.error) return parsed;
  const s = parsed.settings;
  const values = [
    s.mealsEnabled ? 1 : 0, s.breakfastTime, s.lunchTime, s.supperTime,
    s.exerciseEnabled ? 1 : 0, s.exerciseTime, s.waterEnabled ? 1 : 0
  ];
  const existing = await get('SELECT user_id FROM reminder_settings WHERE user_id = ?', [userId]);
  if (existing) {
    await run(
      `UPDATE reminder_settings SET meals_enabled = ?, breakfast_time = ?, lunch_time = ?, supper_time = ?,
         exercise_enabled = ?, exercise_time = ?, water_enabled = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
      [...values, userId]
    );
  } else {
    await run(
      `INSERT INTO reminder_settings (user_id, meals_enabled, breakfast_time, lunch_time, supper_time,
         exercise_enabled, exercise_time, water_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, ...values]
    );
  }
  return { settings: s };
}

function parseSubscription(value) {
  const subscription = value && typeof value === 'object' ? value : {};
  const endpoint = String(subscription.endpoint || '');
  const keys = subscription.keys || {};
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 600) return null;
  const p256dh = String(keys.p256dh || '');
  const auth = String(keys.auth || '');
  if (!/^[A-Za-z0-9_-]{40,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

function describeDevice(userAgent) {
  const ua = String(userAgent || '');
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android phone' : /Windows/.test(ua) ? 'Windows PC' : /Mac OS/.test(ua) ? 'Mac' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return browser ? `${os} · ${browser}` : os;
}

async function saveSubscription(userId, rawSubscription, userAgent) {
  const subscription = parseSubscription(rawSubscription);
  if (!subscription) return { error: 'This browser sent an invalid notification subscription.' };
  // The same phone may have belonged to another student before: the endpoint moves to this one.
  await run('DELETE FROM push_subscriptions WHERE endpoint = ?', [subscription.endpoint]);
  await run(
    'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device) VALUES (?, ?, ?, ?, ?)',
    [userId, subscription.endpoint, subscription.p256dh, subscription.auth, describeDevice(userAgent).slice(0, 80)]
  );
  return { ok: true };
}

async function removeSubscription(userId, endpoint) {
  await run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [userId, String(endpoint || '')]);
}

async function listDevices(userId) {
  const rows = await all('SELECT endpoint, device, created_at, last_sent_at FROM push_subscriptions WHERE user_id = ? ORDER BY id', [userId]);
  return rows.map((row) => ({ endpoint: row.endpoint, device: row.device || 'Device', createdAt: row.created_at, lastSentAt: row.last_sent_at }));
}

async function getStatus(userId) {
  const { publicKey } = await ensureVapidKeys();
  return { publicKey, settings: await getSettings(userId), devices: await listDevices(userId), waterTimes: WATER_TIMES };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------
async function sendToUser(userId, message) {
  await ensureVapidKeys();
  const subscriptions = await all('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?', [userId]);
  const payload = JSON.stringify(message);
  let sent = 0;
  for (const row of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        payload,
        { TTL: 60 * 60, urgency: 'normal', topic: String(message.tag || 'kitchen').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) }
      );
      sent += 1;
      await run('UPDATE push_subscriptions SET last_sent_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id]);
    } catch (error) {
      if (error && (error.statusCode === 404 || error.statusCode === 410)) {
        // The student uninstalled, cleared site data or turned notifications off.
        await run('DELETE FROM push_subscriptions WHERE id = ?', [row.id]);
      } else {
        console.error(`Push to user ${userId} failed:`, error && (error.statusCode || error.message));
      }
    }
  }
  return { sent, devices: subscriptions.length };
}

// ---------------------------------------------------------------------------
// Writing each reminder from the student's own day
// ---------------------------------------------------------------------------
const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', supper: 'Supper' };

function mealMessage(slot, snap) {
  if (snap.mealsBySlot.has(slot)) return null; // already eaten and logged
  const { today, targets } = snap;
  const hello = snap.firstName ? `${snap.firstName}, ` : '';
  const proteinLeft = Math.round(targets.protein - today.protein);
  const fiberLeft = Math.round(targets.fiber - today.fiber);
  let body;
  if (slot === 'breakfast') {
    body = `${hello}start the day well: porridge with eggs, or bread with peanut butter and a fruit, helps you focus in lectures.`;
  } else if (proteinLeft > 15 && fiberLeft > 8) {
    body = `${hello}you still need about ${proteinLeft} g protein and ${fiberLeft} g fibre today. Try a meal with chicken, beef or beans plus vegetables.`;
  } else if (proteinLeft > 15) {
    body = `${hello}about ${proteinLeft} g protein to go today. Chicken, fish, beef, beans or eggs will cover it.`;
  } else if (fiberLeft > 8) {
    body = `${hello}add vegetables, beans or a salad to this meal for ${fiberLeft} g more fibre.`;
  } else {
    body = `${hello}time for ${slot}. You are on track today, so keep the plate balanced.`;
  }
  return {
    title: `${MEAL_LABEL[slot]} time 🍽️`,
    body,
    url: slot === 'breakfast' ? '/diet-monitoring.html#today' : '/home.html#menu',
    tag: `meal-${slot}`,
    actions: [{ action: 'log', title: 'Log my meal' }]
  };
}

function exerciseMessage(snap) {
  const target = Math.round(snap.targets.activityMinutes || 30);
  const done = Math.round(snap.today.activeMinutes || 0);
  if (done >= target) return null;
  const left = target - done;
  const steps = snap.today.steps;
  const walk = Math.min(left, 30);
  return {
    title: `${left} active minutes to go 🏃`,
    body: steps !== null && steps !== undefined
      ? `You're at ${Number(steps).toLocaleString('en-US')} steps today. A ${walk}-minute brisk walk around campus would help close your ring.`
      : `You've done ${done} of ${target} minutes today. A ${walk}-minute brisk walk, a jog or a quick workout in your room counts.`,
    url: '/diet-monitoring.html#today',
    tag: 'exercise',
    actions: [{ action: 'log', title: 'Log activity' }]
  };
}

function waterMessage(kind, snap) {
  const share = kind === 'water-am' ? 0.3 : 0.65; // expected progress by mid-morning / mid-afternoon
  if (snap.waterMl >= snap.waterTarget * share) return null;
  const glasses = Math.round(snap.waterMl / 250);
  const targetGlasses = Math.round(snap.waterTarget / 250);
  return {
    title: 'Time for a glass of water 💧',
    body: `You've had ${glasses} of ${targetGlasses} glasses today. Water is free and better than a fizzy drink.`,
    url: '/diet-monitoring.html#today',
    tag: kind,
    actions: [{ action: 'log', title: 'Add a glass' }]
  };
}

function buildMessage(kind, snap) {
  if (MEAL_LABEL[kind]) return mealMessage(kind, snap);
  if (kind === 'exercise') return exerciseMessage(snap);
  if (WATER_TIMES[kind]) return waterMessage(kind, snap);
  return null;
}

function dueKinds(settings) {
  const kinds = [];
  if (settings.mealsEnabled) {
    kinds.push(['breakfast', settings.breakfastTime], ['lunch', settings.lunchTime], ['supper', settings.supperTime]);
  }
  if (settings.exerciseEnabled) kinds.push(['exercise', settings.exerciseTime]);
  if (settings.waterEnabled) kinds.push(...Object.entries(WATER_TIMES));
  return kinds;
}

const toMinutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

// Checks every subscribed student and sends any reminder that is due now.
async function tick() {
  const now = dietService.wallClock();
  const day = now.slice(0, 10);
  const nowMinutes = toMinutes(now.slice(11, 16));
  const rows = await all(
    `SELECT DISTINCT s.user_id, r.meals_enabled, r.breakfast_time, r.lunch_time, r.supper_time,
            r.exercise_enabled, r.exercise_time, r.water_enabled
     FROM push_subscriptions s LEFT JOIN reminder_settings r ON r.user_id = s.user_id`
  );
  if (!rows.length) return { checked: 0, sent: 0 };
  const sentToday = await all('SELECT user_id, kind FROM reminder_log WHERE day = ?', [day]);
  const already = new Set(sentToday.map((row) => `${Number(row.user_id)}:${row.kind}`));

  const due = [];
  for (const row of rows) {
    const userId = Number(row.user_id);
    const settings = row.meals_enabled === null || row.meals_enabled === undefined ? DEFAULT_SETTINGS : rowToSettings(row);
    for (const [kind, time] of dueKinds(settings)) {
      const late = nowMinutes - toMinutes(time);
      if (late < 0 || late > CATCH_UP_MINUTES || already.has(`${userId}:${kind}`)) continue;
      due.push({ userId, kind });
    }
  }
  if (!due.length) return { checked: rows.length, sent: 0 };

  const snapshots = await dietService.reminderSnapshots(due.map((entry) => entry.userId));
  let sent = 0;
  for (const { userId, kind } of due) {
    try {
      // Claim the reminder first so two overlapping ticks cannot both send it.
      await run('INSERT INTO reminder_log (user_id, kind, day) VALUES (?, ?, ?)', [userId, kind, day]);
    } catch {
      continue;
    }
    const snap = snapshots.get(userId);
    const message = snap ? buildMessage(kind, snap) : null;
    if (!message) continue; // nothing useful to say: already done
    const result = await sendToUser(userId, message);
    sent += result.sent;
  }
  return { checked: rows.length, sent };
}

let running = false;
async function safeTick() {
  if (running) return null;
  running = true;
  try {
    return await tick();
  } catch (error) {
    console.error('Reminder check failed:', error);
    return null;
  } finally {
    running = false;
  }
}

function startScheduler() {
  setTimeout(safeTick, 15 * 1000);
  setInterval(safeTick, 60 * 1000).unref();
}

async function sendTest(userId) {
  const snap = (await dietService.reminderSnapshots([userId])).get(userId);
  const hello = snap && snap.firstName ? `Hi ${snap.firstName}! ` : '';
  return sendToUser(userId, {
    title: 'Reminders are on ✅',
    body: `${hello}THE KITCHEN will remind you about meals, water and exercise at the times you chose.`,
    url: '/diet-monitoring.html',
    tag: 'test'
  });
}

module.exports = {
  ensureVapidKeys,
  getStatus,
  saveSettings,
  saveSubscription,
  removeSubscription,
  sendTest,
  safeTick,
  startScheduler,
  _internal: { buildMessage, dueKinds, parseSettings, parseSubscription, describeDevice, DEFAULT_SETTINGS }
};
