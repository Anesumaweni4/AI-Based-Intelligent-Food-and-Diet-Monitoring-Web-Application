const express = require('express');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { initializeDatabase, get, all, run, withTransaction, replaceMenuSchedule } = require('./db');
const { hashPassword, verifyPassword, passwordNeedsRehash } = require('./passwords');
const { getNutrition, recommendFoods, GOALS } = require('./diet-model');

const app = express();
const PORT = process.env.PORT || 3000;
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ADMIN_SESSION_COOKIE = 'foodieAdminSession';
const ACCOUNT_SESSION_COOKIE = 'foodieAccountSession';
const ADMIN_SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const PASSWORD_RESET_DURATION_MS = 60 * 60 * 1000;
const passwordResetRequests = new Map();
const CLIENT_FEEDBACK_CATEGORIES = new Set(['food', 'order', 'service', 'website', 'other']);
const CLIENT_FEEDBACK_STATUSES = new Set(['new', 'reviewing', 'resolved']);

if (SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters long.');
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmail(email) {
  return email.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getPasswordResetBaseUrl() {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) return null;

  let appUrl;
  try {
    appUrl = new URL(baseUrl);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(appUrl.protocol) ||
      (process.env.NODE_ENV === 'production' && appUrl.protocol !== 'https:') ||
      appUrl.username || appUrl.password) {
    return null;
  }
  return appUrl.origin;
}

function getPasswordResetMailer() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  const baseUrl = getPasswordResetBaseUrl();
  if (!host || !Number.isInteger(port) || port <= 0 || !user || !pass || !from || !baseUrl) {
    return null;
  }

  return {
    transporter: nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass }
    }),
    from,
    baseUrl
  };
}

function getWhatsAppPasswordResetConfig() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const templateName = process.env.WHATSAPP_RESET_TEMPLATE;
  const apiVersion = process.env.WHATSAPP_API_VERSION;
  const baseUrl = getPasswordResetBaseUrl();
  if (!phoneNumberId || !/^\d+$/.test(phoneNumberId) ||
      !accessToken || !templateName || !/^[a-z0-9_]+$/i.test(templateName) ||
      !apiVersion || !/^v\d+\.\d+$/.test(apiVersion) || !baseUrl) {
    return null;
  }

  return {
    phoneNumberId,
    accessToken,
    templateName,
    language: process.env.WHATSAPP_RESET_TEMPLATE_LANGUAGE || 'en',
    apiVersion,
    baseUrl
  };
}

async function sendWhatsAppPasswordReset(config, phoneNumber, resetUrl) {
  const response = await fetch(
    `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phoneNumber.slice(1),
        type: 'template',
        template: {
          name: config.templateName,
          language: { code: config.language },
          components: [{
            type: 'body',
            parameters: [{ type: 'text', text: resetUrl }]
          }]
        }
      }),
      signal: AbortSignal.timeout(10000)
    }
  );
  if (!response.ok) {
    throw new Error(`WhatsApp Cloud API returned HTTP ${response.status}.`);
  }
}

function allowPasswordResetRequest(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const previous = passwordResetRequests.get(ip) || [];
  const recent = previous.filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= 5) {
    passwordResetRequests.set(ip, recent);
    return false;
  }
  recent.push(now);
  passwordResetRequests.set(ip, recent);
  if (passwordResetRequests.size > 10000) {
    for (const [address, timestamps] of passwordResetRequests) {
      if (!timestamps.some((timestamp) => now - timestamp < windowMs)) {
        passwordResetRequests.delete(address);
      }
    }
  }
  return true;
}

function getCurrentMenuDay() {
  const now = new Date();
  const dayOfWeek = (now.getDay() + 6) % 7;
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
  return { dayOfWeek, date, dayName: WEEKDAY_NAMES[dayOfWeek] };
}

function getCurrentRevenueDayRange() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfNextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const toDatabaseTimestamp = (date) => date.toISOString().slice(0, 19).replace('T', ' ');
  return {
    start: toDatabaseTimestamp(startOfDay),
    end: toDatabaseTimestamp(startOfNextDay)
  };
}

function getLocalDayRange(daysBeforeToday = 0) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - daysBeforeToday);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const toDatabaseTimestamp = (date) => {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };
  return { start: toDatabaseTimestamp(start), end: toDatabaseTimestamp(end) };
}

function getBillingPeriodRange(period) {
  if (typeof period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    return null;
  }
  const [year, month] = period.split('-').map(Number);
  if (year < 2000) return null;
  const nextMonth = month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return {
    period,
    start: `${period}-01 00:00:00`,
    end: `${nextMonth}-01 00:00:00`,
    isClosed: period < currentPeriod
  };
}

function sumDietNutrition(meals) {
  return meals.reduce((totals, meal) => {
    const servings = Number(meal.servings);
    for (const field of ['calories', 'protein', 'carbohydrates', 'fat', 'fiber']) {
      totals[field] += Number(meal[field]) * servings;
    }
    return totals;
  }, { calories: 0, protein: 0, carbohydrates: 0, fat: 0, fiber: 0 });
}

function signAdminSession(user) {
  const payload = Buffer.from(JSON.stringify({
    userId: Number(user.id),
    sessionVersion: Number(user.session_version),
    passwordHash: crypto.createHash('sha256').update(user.password).digest('hex'),
    expiresAt: Date.now() + ADMIN_SESSION_DURATION_MS
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || '';
  const cookie = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : null;
}

function setAdminSessionCookie(req, res, user) {
  clearAccountSessionCookie(req, res);
  res.cookie(ADMIN_SESSION_COOKIE, signAdminSession(user), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_SESSION_DURATION_MS
  });
}

function setAccountSessionCookie(res, user) {
  const payload = Buffer.from(JSON.stringify({
    userId: Number(user.id),
    sessionVersion: Number(user.session_version),
    expiresAt: Date.now() + ADMIN_SESSION_DURATION_MS
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  res.cookie(ACCOUNT_SESSION_COOKIE, `${payload}.${signature}`, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_SESSION_DURATION_MS
  });
}

function clearAccountSessionCookie(req, res) {
  res.clearCookie(ACCOUNT_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  });
}

function clearAdminSessionCookie(req, res) {
  res.clearCookie(ADMIN_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  });
}

function getPublicUser(user) {
  return {
    id: user.id,
    fullName: user.full_name,
    username: user.username,
    age: user.age,
    weight: user.weight,
    height: user.height,
    walletBalanceCents: Number(user.wallet_balance_cents || 0),
    role: user.role
  };
}

function establishAuthenticatedSession(req, res, user) {
  if (user.role === 'admin') {
    setAdminSessionCookie(req, res, user);
  } else {
    clearAdminSessionCookie(req, res);
    setAccountSessionCookie(res, user);
  }
}

async function getAuthenticatedAdmin(req) {
  const token = getCookie(req, ADMIN_SESSION_COOKIE);
  if (!token) return null;

  const [payload, providedSignature, extra] = token.split('.');
  if (!payload || !providedSignature || extra !== undefined) return null;

  const expectedSignature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest();
  let actualSignature;
  try {
    actualSignature = Buffer.from(providedSignature, 'base64url');
  } catch {
    return null;
  }
  if (actualSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(actualSignature, expectedSignature)) {
    return null;
  }

  let session;
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!Number.isSafeInteger(session.userId) ||
      !Number.isSafeInteger(session.sessionVersion) ||
      !Number.isSafeInteger(session.expiresAt) ||
      session.expiresAt <= Date.now()) {
    return null;
  }

  const user = await get('SELECT id, role, password, session_version FROM users WHERE id = ?', [session.userId]);
  if (!user || user.role !== 'admin' || Number(user.session_version) !== session.sessionVersion) return null;

  const currentPasswordHash = crypto.createHash('sha256').update(user.password).digest('hex');
  const sessionPasswordHash = Buffer.from(String(session.passwordHash || ''), 'hex');
  const currentPasswordHashBuffer = Buffer.from(currentPasswordHash, 'hex');
  if (sessionPasswordHash.length !== currentPasswordHashBuffer.length ||
      !crypto.timingSafeEqual(sessionPasswordHash, currentPasswordHashBuffer)) {
    return null;
  }

  return user;
}

async function getAuthenticatedAccount(req) {
  const token = getCookie(req, ACCOUNT_SESSION_COOKIE);
  if (!token) return null;

  const [payload, providedSignature, extra] = token.split('.');
  if (!payload || !providedSignature || extra !== undefined) return null;

  const expectedSignature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest();
  const actualSignature = Buffer.from(providedSignature, 'base64url');
  if (actualSignature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(actualSignature, expectedSignature)) {
    return null;
  }

  let session;
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Number.isSafeInteger(session.userId) ||
      !Number.isSafeInteger(session.sessionVersion) ||
      !Number.isSafeInteger(session.expiresAt) ||
      session.expiresAt <= Date.now()) {
    return null;
  }

  const user = await get(
    'SELECT id, full_name, username, role, session_version FROM users WHERE id = ?',
    [session.userId]
  );
  if (!user || Number(user.session_version) !== session.sessionVersion ||
      !['staff', 'cashier'].includes(user.role)) {
    return null;
  }
  return user;
}

async function requireAdminApi(req, res, next) {
  try {
    const user = await getAuthenticatedAdmin(req);
    if (!user) {
      return res.status(401).json({ message: 'Administrator login is required.' });
    }
    req.adminUser = user;
    next();
  } catch (error) {
    console.error('Error verifying administrator session:', error);
    res.status(500).json({ message: 'Unable to verify administrator access.' });
  }
}

async function requireCashierOrAdminApi(req, res, next) {
  try {
    const admin = await getAuthenticatedAdmin(req);
    if (admin) {
      req.accountUser = admin;
      return next();
    }
    const account = await getAuthenticatedAccount(req);
    if (!account || account.role !== 'cashier') {
      return res.status(401).json({ message: 'Cashier or administrator login is required.' });
    }
    req.accountUser = account;
    next();
  } catch (error) {
    console.error('Error verifying cashier access:', error);
    res.status(500).json({ message: 'Unable to verify cashier access.' });
  }
}

async function requireCashierOrAdminPage(req, res, next) {
  try {
    const admin = await getAuthenticatedAdmin(req);
    const account = admin ? null : await getAuthenticatedAccount(req);
    if (!admin && (!account || account.role !== 'cashier')) {
      return res.redirect('/login.html');
    }
    next();
  } catch (error) {
    console.error('Error verifying staff dashboard access:', error);
    res.status(500).send('Unable to verify staff dashboard access.');
  }
}

async function requireStudentPage(req, res, next) {
  try {
    const account = await getAuthenticatedAccount(req);
    if (!account || account.role !== 'staff') {
      return res.redirect('/login.html');
    }
    next();
  } catch (error) {
    console.error('Error verifying customer page access:', error);
    res.status(500).send('Unable to verify customer login.');
  }
}

async function requireStudentApi(req, res, next) {
  try {
    const account = await getAuthenticatedAccount(req);
    if (!account || account.role !== 'staff') {
      return res.status(401).json({ message: 'Student login is required.' });
    }
    req.accountUser = account;
    next();
  } catch (error) {
    console.error('Error verifying student account:', error);
    res.status(500).json({ message: 'Unable to verify student account.' });
  }
}

app.use(express.json());
app.get('/cashier-login.html', (req, res) => {
  res.redirect('/login.html');
});
app.get('/admin-login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

app.get('/admin.html', async (req, res) => {
  try {
    if (!await getAuthenticatedAdmin(req)) {
      return res.redirect('/admin-login.html');
    }
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  } catch (error) {
    console.error('Error verifying administrator page access:', error);
    res.status(500).send('Unable to verify administrator access.');
  }
});

app.get('/cashier.html', async (req, res) => {
  try {
    const admin = await getAuthenticatedAdmin(req);
    const account = admin ? null : await getAuthenticatedAccount(req);
    if (!admin && (!account || account.role !== 'cashier')) {
      return res.redirect('/login.html');
    }
    res.sendFile(path.join(__dirname, 'public', 'cashier.html'));
  } catch (error) {
    console.error('Error verifying cashier page access:', error);
    res.status(500).send('Unable to verify cashier access.');
  }
});
app.get('/api/staff/session', requireCashierOrAdminApi, (req, res) => {
  res.json({ role: req.accountUser.role });
});
app.get('/api/student/session', requireStudentApi, (req, res) => {
  res.json({ role: req.accountUser.role });
});
app.get('/restaurant.html', requireCashierOrAdminPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'restaurant.html'));
});
app.get('/delivery.html', requireCashierOrAdminPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'delivery.html'));
});
app.get('/home.html', requireStudentPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});
app.get('/diet-monitoring.html', requireStudentPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'diet-monitoring.html'));
});
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/home', requireStudentPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Food ordering app is running' });
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const user = await getAuthenticatedAdmin(req);
    if (user) {
      await run('UPDATE users SET session_version = session_version + 1 WHERE id = ?', [user.id]);
    }
    clearAdminSessionCookie(req, res);
    clearAccountSessionCookie(req, res);
    res.json({ message: 'Logged out.' });
  } catch (error) {
    console.error('Error logging out administrator:', error);
    res.status(500).json({ message: 'Unable to safely end the administrator session.' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { fullName, username, password, age, weight, height } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!fullName || !username || !password || !email) {
      return res.status(400).json({ message: 'Full name, username, email, and password are required.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }

    const parsedAge = Number(age);
    const parsedWeight = Number(weight);
    const parsedHeight = Number(height);

    if (!Number.isFinite(parsedAge) || parsedAge <= 0 || !Number.isFinite(parsedWeight) || parsedWeight <= 0 || !Number.isFinite(parsedHeight) || parsedHeight <= 0) {
      return res.status(400).json({ message: 'Please provide valid age, weight, and height values.' });
    }

    const existingUser = await get('SELECT id FROM users WHERE username = ?', [username.trim()]);
    if (existingUser) {
      return res.status(409).json({ message: 'That username already exists.' });
    }
    if (await get('SELECT id FROM users WHERE email = ?', [email])) {
      return res.status(409).json({ message: 'That email address is already linked to an account.' });
    }

    const user = await run(
      'INSERT INTO users (full_name, username, password, role, email, age, weight, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [fullName.trim(), username.trim(), await hashPassword(password), 'staff', email, parsedAge, parsedWeight, parsedHeight]
    );

    res.status(201).json({
      message: 'Account created successfully.',
      user: {
        id: user.id,
        fullName: fullName.trim(),
        username: username.trim(),
        age: parsedAge,
        weight: parsedWeight,
        height: parsedHeight,
        role: 'staff'
      }
    });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ message: 'Registration failed.' });
  }
});

app.post('/api/auth/password-reset/request', async (req, res) => {
  if (!allowPasswordResetRequest(req.ip)) {
    return res.status(429).json({ message: 'Too many reset requests. Please wait 15 minutes and try again.' });
  }

  const delivery = req.body.delivery === undefined ? 'email' : req.body.delivery;
  if (!['email', 'whatsapp'].includes(delivery)) {
    return res.status(400).json({ message: 'Choose email or WhatsApp as the reset-link delivery method.' });
  }
  const mailer = delivery === 'email' ? getPasswordResetMailer() : null;
  const whatsapp = delivery === 'whatsapp' ? getWhatsAppPasswordResetConfig() : null;
  if (delivery === 'email' && !mailer) {
    return res.status(503).json({ message: 'Password reset email is not configured. Please contact the administrator.' });
  }
  if (delivery === 'whatsapp' && !whatsapp) {
    return res.status(503).json({ message: 'WhatsApp password reset is not configured yet. Please contact the administrator or choose email.' });
  }
  const email = normalizeEmail(req.body.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ message: 'Enter a valid email address.' });
  }

  try {
    const user = await get(
      "SELECT id, full_name, email, recovery_whatsapp FROM users WHERE email = ? AND role = 'staff'",
      [email]
    );
    const canDeliver = user && (delivery === 'email' ? user.email : user.recovery_whatsapp);
    if (canDeliver) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      await withTransaction(async (transaction) => {
        await transaction.run('DELETE FROM password_reset_tokens WHERE user_id = ?', [user.id]);
        await transaction.run('DELETE FROM password_reset_tokens WHERE expires_at_ms <= ?', [Date.now()]);
        await transaction.run(
          'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at_ms) VALUES (?, ?, ?)',
          [user.id, tokenHash, Date.now() + PASSWORD_RESET_DURATION_MS]
        );
      });

      const resetUrl = new URL('/reset-password.html', delivery === 'email' ? mailer.baseUrl : whatsapp.baseUrl);
      resetUrl.searchParams.set('token', rawToken);
      try {
        if (delivery === 'email') {
          await mailer.transporter.sendMail({
            from: mailer.from,
            to: user.email,
            subject: 'Reset your THE KITCHEN password',
            text: `Hello ${user.full_name},\n\nUse this link within one hour to reset your password:\n${resetUrl.toString()}\n\nIf you did not request a password reset, you can ignore this email.`
          });
        } else {
          await sendWhatsAppPasswordReset(whatsapp, user.recovery_whatsapp, resetUrl.toString());
        }
      } catch (error) {
        await run('DELETE FROM password_reset_tokens WHERE token_hash = ?', [tokenHash]);
        throw error;
      }
    }
    res.json({
      message: delivery === 'email'
        ? 'If an account is registered with that email, a password reset link will be sent shortly.'
        : 'If an account with a confirmed WhatsApp recovery number is registered with that email, a reset link will be sent shortly.'
    });
  } catch (error) {
    console.error(`Error sending password reset via ${delivery}:`, error);
    res.status(500).json({
      message: delivery === 'email'
        ? 'Unable to send the password reset email right now. Please try again later.'
        : 'Unable to send the password reset WhatsApp message right now. Please try again later.'
    });
  }
});

app.post('/api/auth/password-reset/complete', async (req, res) => {
  if (!allowPasswordResetRequest(req.ip)) {
    return res.status(429).json({ message: 'Too many reset attempts. Please wait 15 minutes and try again.' });
  }
  const token = typeof req.body.token === 'string' ? req.body.token : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ message: 'This reset link is invalid or has expired. Request a new one.' });
  }
  if (password.length < 8 || password.length > 256) {
    return res.status(400).json({ message: 'Your new password must be between 8 and 256 characters.' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const passwordHash = await hashPassword(password);
    const updated = await withTransaction(async (transaction) => {
      const reset = await transaction.get(
        `SELECT t.id, t.user_id
         FROM password_reset_tokens t
         JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = ? AND t.expires_at_ms > ? AND u.role = 'staff'`,
        [tokenHash, Date.now()]
      );
      if (!reset) return false;
      await transaction.run(
        'UPDATE users SET password = ?, session_version = session_version + 1 WHERE id = ?',
        [passwordHash, reset.user_id]
      );
      await transaction.run('DELETE FROM password_reset_tokens WHERE user_id = ?', [reset.user_id]);
      return true;
    });
    if (!updated) {
      return res.status(400).json({ message: 'This reset link is invalid or has expired. Request a new one.' });
    }
    res.json({ message: 'Your password has been reset. You can now log in with your new password.' });
  } catch (error) {
    console.error('Error resetting student password:', error);
    res.status(500).json({ message: 'Unable to reset the password right now. Please try again later.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const requestedRole = String(role || 'user').toLowerCase();

    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }
    if (!['admin', 'cashier', 'user', 'auto'].includes(requestedRole)) {
      return res.status(400).json({ message: 'Choose a valid account type.' });
    }

    const user = await get('SELECT * FROM users WHERE username = ?', [username.trim()]);
    if (!user || !await verifyPassword(password, user.password)) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    if (requestedRole === 'admin' && user.role !== 'admin') {
      return res.status(403).json({ message: 'This account does not have admin access.' });
    }

    if (requestedRole === 'cashier' && user.role !== 'cashier') {
      return res.status(403).json({ message: 'This account does not have cashier access.' });
    }

    if (requestedRole === 'user' && user.role !== 'staff') {
      return res.status(403).json({ message: 'Use the appropriate login page for this account.' });
    }

    if (requestedRole === 'auto' && !['admin', 'cashier', 'staff'].includes(user.role)) {
      return res.status(403).json({ message: 'This account type cannot sign in here.' });
    }

    if (passwordNeedsRehash(user.password)) {
      user.password = await hashPassword(password);
      await run('UPDATE users SET password = ? WHERE id = ?', [user.password, user.id]);
    }

    establishAuthenticatedSession(req, res, user);
    res.json({ message: 'Login successful.', user: getPublicUser(user) });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ message: 'Login failed.' });
  }
});

app.get('/api/account', requireStudentApi, async (req, res) => {
  try {
    const user = await get(
      'SELECT id, full_name, username, wallet_balance_cents, monthly_account_enabled FROM users WHERE id = ?',
      [req.accountUser.id]
    );
    const transactions = await all(
      `SELECT amount_cents, type, created_at
       FROM account_transactions
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT 10`,
      [req.accountUser.id]
    );
    const monthlyBalance = await get(
      `SELECT COALESCE(ROUND(SUM(o.total * 100)), 0) AS balance_cents
       FROM orders o
       WHERE o.user_id = ?
         AND o.payment_method = 'monthly'
         AND o.status IN ('Collected', 'Delivered')
         AND NOT EXISTS (
           SELECT 1 FROM monthly_invoice_orders mio WHERE mio.order_id = o.id
         )`,
      [req.accountUser.id]
    );
    const unpaidInvoices = await get(
      "SELECT COALESCE(SUM(total_cents), 0) AS balance_cents FROM monthly_invoices WHERE user_id = ? AND status = 'unpaid'",
      [req.accountUser.id]
    );
    res.json({
      user: {
        id: user.id,
        fullName: user.full_name,
        username: user.username,
        balanceCents: Number(user.wallet_balance_cents),
        monthlyAccountEnabled: Boolean(user.monthly_account_enabled),
        monthlyBalanceCents: Number(monthlyBalance.balance_cents) + Number(unpaidInvoices.balance_cents)
      },
      transactions
    });
  } catch (error) {
    console.error('Error loading student account:', error);
    res.status(500).json({ message: 'Unable to load your account balance.' });
  }
});

app.get('/api/account/orders', requireStudentApi, async (req, res) => {
  try {
    const orders = await all(
      `SELECT id, status, total, created_at
       FROM orders
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT 20`,
      [req.accountUser.id]
    );
    if (orders.length) {
      const orderItems = await all(
        `SELECT oi.order_id, oi.quantity, oi.unit_price, mi.name AS item_name
         FROM order_items oi
         JOIN menu_items mi ON mi.id = oi.menu_item_id
         WHERE oi.order_id IN (${orders.map(() => '?').join(', ')})
         ORDER BY oi.id`,
        orders.map(order => order.id)
      );
      const itemsByOrderId = new Map();
      orderItems.forEach(item => {
        const items = itemsByOrderId.get(Number(item.order_id)) || [];
        items.push(item);
        itemsByOrderId.set(Number(item.order_id), items);
      });
      orders.forEach(order => {
        order.items = itemsByOrderId.get(Number(order.id)) || [];
      });
    }
    res.json(orders);
  } catch (error) {
    console.error('Error loading student orders:', error);
    res.status(500).json({ message: 'Unable to load your order updates.' });
  }
});

app.get('/api/feedback', requireStudentApi, async (req, res) => {
  try {
    const feedback = await all(
      `SELECT id, category, message, status, created_at
       FROM client_feedback
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT 20`,
      [req.accountUser.id]
    );
    res.json(feedback);
  } catch (error) {
    console.error('Error loading client feedback:', error);
    res.status(500).json({ message: 'Unable to load your feedback history.' });
  }
});

app.post('/api/feedback', requireStudentApi, async (req, res) => {
  const category = typeof req.body.category === 'string' ? req.body.category : '';
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (!CLIENT_FEEDBACK_CATEGORIES.has(category)) {
    return res.status(400).json({ message: 'Choose a feedback topic before sending your message.' });
  }
  if (!message || message.length > 2000) {
    return res.status(400).json({ message: 'Write feedback of up to 2,000 characters.' });
  }

  try {
    const result = await run(
      'INSERT INTO client_feedback (user_id, category, message) VALUES (?, ?, ?)',
      [req.accountUser.id, category, message]
    );
    res.status(201).json({
      message: 'Thank you for sharing your feedback. The team will review it.',
      feedback: { id: result.id, category, message, status: 'new' }
    });
  } catch (error) {
    console.error('Error saving client feedback:', error);
    res.status(500).json({ message: 'Unable to send your feedback right now.' });
  }
});

app.get('/api/diet', requireStudentApi, async (req, res) => {
  try {
    const todayRange = getLocalDayRange();
    const weekRange = getLocalDayRange(6);
    const todayMeals = await all(
      `SELECT id, menu_item_id, food_name, servings, calories, protein, carbohydrates, fat, fiber, eaten_at
       FROM diet_meal_logs
       WHERE user_id = ? AND eaten_at >= ? AND eaten_at < ?
       ORDER BY eaten_at DESC, id DESC`,
      [req.accountUser.id, todayRange.start, todayRange.end]
    );
    const weekMeals = await all(
      `SELECT food_name, servings, calories, protein, carbohydrates, fat, fiber, eaten_at
       FROM diet_meal_logs
       WHERE user_id = ? AND eaten_at >= ? AND eaten_at < ?
       ORDER BY eaten_at ASC, id ASC`,
      [req.accountUser.id, weekRange.start, todayRange.end]
    );
    const profile = await get('SELECT goal FROM diet_profiles WHERE user_id = ?', [req.accountUser.id]);
    const menuItems = await all('SELECT id, name, category FROM menu_items ORDER BY name');
    const feedback = await all(
      'SELECT rating, calories, protein, carbohydrates, fat, fiber FROM diet_feedback WHERE user_id = ?',
      [req.accountUser.id]
    );
    const todayTotals = sumDietNutrition(todayMeals);
    const dailyTotals = {
      ...todayTotals,
      foodNames: new Set(todayMeals.map((meal) => String(meal.food_name).toLowerCase()))
    };
    const groupedDays = new Map();
    for (const meal of weekMeals) {
      const date = String(meal.eaten_at).slice(0, 10);
      if (!groupedDays.has(date)) {
        groupedDays.set(date, { date, meals: 0, ...sumDietNutrition([]) });
      }
      const totals = groupedDays.get(date);
      totals.meals += Number(meal.servings);
      for (const field of ['calories', 'protein', 'carbohydrates', 'fat', 'fiber']) {
        totals[field] += Number(meal[field]) * Number(meal.servings);
      }
    }
    const recommendation = recommendFoods({
      foods: menuItems,
      feedback,
      goal: profile ? profile.goal : 'balanced',
      dailyTotals
    });

    res.json({
      goal: profile ? profile.goal : 'balanced',
      foods: menuItems.map((item) => ({ ...item, ...getNutrition(item) })),
      meals: todayMeals,
      totals: todayTotals,
      weekly: Array.from(groupedDays.values()),
      recommendations: recommendation.items,
      model: recommendation.model
    });
  } catch (error) {
    console.error('Error loading diet monitoring data:', error);
    res.status(500).json({ message: 'Unable to load diet monitoring data.' });
  }
});

app.post('/api/diet/meals', requireStudentApi, async (req, res) => {
  const menuItemId = Number(req.body.menuItemId);
  const servings = Number(req.body.servings);
  if (!Number.isSafeInteger(menuItemId) || menuItemId <= 0 ||
      !Number.isFinite(servings) || servings <= 0 || servings > 5 ||
      Math.round(servings * 2) !== servings * 2) {
    return res.status(400).json({ message: 'Choose a menu food and enter a serving amount from 0.5 to 5.' });
  }

  try {
    const food = await get('SELECT id, name, category FROM menu_items WHERE id = ?', [menuItemId]);
    if (!food) {
      return res.status(404).json({ message: 'That food is no longer available in the menu.' });
    }
    const nutrition = getNutrition(food);
    const result = await run(
      `INSERT INTO diet_meal_logs
       (user_id, menu_item_id, food_name, servings, calories, protein, carbohydrates, fat, fiber)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.accountUser.id, food.id, food.name, servings,
        nutrition.calories, nutrition.protein, nutrition.carbohydrates, nutrition.fat, nutrition.fiber
      ]
    );
    res.status(201).json({ message: 'Meal added to your food diary.', id: result.id });
  } catch (error) {
    console.error('Error recording diet meal:', error);
    res.status(500).json({ message: 'Unable to record that meal.' });
  }
});

app.put('/api/diet/goal', requireStudentApi, async (req, res) => {
  const goal = typeof req.body.goal === 'string' ? req.body.goal : '';
  if (!GOALS.has(goal)) {
    return res.status(400).json({ message: 'Choose one of the available general nutrition focus options.' });
  }

  try {
    await withTransaction(async (transaction) => {
      await transaction.run('DELETE FROM diet_profiles WHERE user_id = ?', [req.accountUser.id]);
      await transaction.run(
        'INSERT INTO diet_profiles (user_id, goal) VALUES (?, ?)',
        [req.accountUser.id, goal]
      );
    });
    res.json({ message: 'Your recommendation focus was saved.', goal });
  } catch (error) {
    console.error('Error saving diet recommendation focus:', error);
    res.status(500).json({ message: 'Unable to save your recommendation focus.' });
  }
});

app.post('/api/diet/feedback', requireStudentApi, async (req, res) => {
  const menuItemId = Number(req.body.menuItemId);
  const rating = Number(req.body.rating);
  if (!Number.isSafeInteger(menuItemId) || menuItemId <= 0 || ![-1, 1].includes(rating)) {
    return res.status(400).json({ message: 'Choose a recommendation and mark it helpful or not helpful.' });
  }

  try {
    const food = await get('SELECT id, name, category FROM menu_items WHERE id = ?', [menuItemId]);
    if (!food) {
      return res.status(404).json({ message: 'That recommendation is no longer available.' });
    }
    const nutrition = getNutrition(food);
    await withTransaction(async (transaction) => {
      await transaction.run(
        'DELETE FROM diet_feedback WHERE user_id = ? AND menu_item_id = ?',
        [req.accountUser.id, food.id]
      );
      await transaction.run(
        `INSERT INTO diet_feedback
         (user_id, menu_item_id, rating, calories, protein, carbohydrates, fat, fiber)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.accountUser.id, food.id, rating,
          nutrition.calories, nutrition.protein, nutrition.carbohydrates, nutrition.fat, nutrition.fiber
        ]
      );
    });
    res.json({ message: 'Thanks. Your feedback will help personalize future suggestions.' });
  } catch (error) {
    console.error('Error saving diet recommendation feedback:', error);
    res.status(500).json({ message: 'Unable to save your recommendation feedback.' });
  }
});

app.use('/api/admin', requireAdminApi);

app.get('/api/admin/feedback', async (req, res) => {
  try {
    const feedback = await all(
      `SELECT f.id, f.category, f.message, f.status, f.created_at,
              u.full_name, u.username
       FROM client_feedback f
       JOIN users u ON u.id = f.user_id
       ORDER BY CASE f.status WHEN 'new' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END, f.id DESC
       LIMIT 200`
    );
    res.json(feedback);
  } catch (error) {
    console.error('Error loading submitted client feedback:', error);
    res.status(500).json({ message: 'Unable to load submitted client feedback.' });
  }
});

app.patch('/api/admin/feedback/:id/status', async (req, res) => {
  const feedbackId = Number(req.params.id);
  const status = typeof req.body.status === 'string' ? req.body.status : '';
  if (!Number.isSafeInteger(feedbackId) || feedbackId <= 0 || !CLIENT_FEEDBACK_STATUSES.has(status)) {
    return res.status(400).json({ message: 'Choose a valid feedback item and review status.' });
  }

  try {
    const existing = await get('SELECT id FROM client_feedback WHERE id = ?', [feedbackId]);
    if (!existing) {
      return res.status(404).json({ message: 'That feedback item could not be found.' });
    }
    await run('UPDATE client_feedback SET status = ? WHERE id = ?', [status, feedbackId]);
    res.json({ message: 'Feedback review status updated.', id: feedbackId, status });
  } catch (error) {
    console.error('Error updating client feedback status:', error);
    res.status(500).json({ message: 'Unable to update the feedback review status.' });
  }
});

app.patch('/api/admin/users/:id/email', async (req, res) => {
  const userId = Number(req.params.id);
  const email = normalizeEmail(req.body.email);
  if (!Number.isSafeInteger(userId) || userId <= 0 || !isValidEmail(email)) {
    return res.status(400).json({ message: 'Enter a valid student email address.' });
  }

  try {
    const student = await get("SELECT id, email FROM users WHERE id = ? AND role = 'staff'", [userId]);
    if (!student) {
      return res.status(404).json({ message: 'Student account not found.' });
    }
    const existingEmail = await get('SELECT id FROM users WHERE email = ? AND id <> ?', [email, userId]);
    if (existingEmail) {
      return res.status(409).json({ message: 'That email address is already linked to another account.' });
    }
    await withTransaction(async (transaction) => {
      await transaction.run('UPDATE users SET email = ? WHERE id = ?', [email, userId]);
      if (student.email !== email) {
        await transaction.run('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
      }
    });
    res.json({ message: 'Student recovery email saved.' });
  } catch (error) {
    console.error('Error saving student recovery email:', error);
    res.status(500).json({ message: 'Unable to save the student recovery email.' });
  }
});

app.patch('/api/admin/users/:id/recovery-whatsapp', async (req, res) => {
  const userId = Number(req.params.id);
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
  if (!Number.isSafeInteger(userId) || userId <= 0 ||
      (phone && !/^\+[1-9]\d{7,14}$/.test(phone))) {
    return res.status(400).json({ message: 'Enter a WhatsApp number in international format, for example +263771234567.' });
  }
  if (phone && req.body.confirmed !== true) {
    return res.status(400).json({ message: 'Confirm that the student agreed to use this number for password recovery.' });
  }

  try {
    const student = await get(
      "SELECT id, recovery_whatsapp FROM users WHERE id = ? AND role = 'staff'",
      [userId]
    );
    if (!student) {
      return res.status(404).json({ message: 'Student account not found.' });
    }
    await withTransaction(async (transaction) => {
      await transaction.run(
        'UPDATE users SET recovery_whatsapp = ? WHERE id = ?',
        [phone || null, userId]
      );
      if (student.recovery_whatsapp !== (phone || null)) {
        await transaction.run('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
      }
    });
    res.json({ message: phone ? 'Confirmed WhatsApp recovery number saved.' : 'WhatsApp recovery number removed.' });
  } catch (error) {
    console.error('Error saving student WhatsApp recovery number:', error);
    res.status(500).json({ message: 'Unable to save the WhatsApp recovery number.' });
  }
});

app.patch('/api/admin/users/:id/monthly-account', async (req, res) => {
  const userId = Number(req.params.id);
  const enabled = req.body.enabled;
  if (!Number.isSafeInteger(userId) || userId <= 0 || typeof enabled !== 'boolean') {
    return res.status(400).json({ message: 'Choose a valid client and monthly billing approval setting.' });
  }

  try {
    const client = await get("SELECT id FROM users WHERE id = ? AND role = 'staff'", [userId]);
    if (!client) {
      return res.status(404).json({ message: 'Client account not found.' });
    }
    await run('UPDATE users SET monthly_account_enabled = ? WHERE id = ?', [enabled, userId]);
    res.json({
      message: enabled ? 'Monthly billing approved for this client.' : 'Monthly billing disabled for this client.',
      enabled
    });
  } catch (error) {
    console.error('Error updating client monthly billing approval:', error);
    res.status(500).json({ message: 'Unable to update monthly billing approval.' });
  }
});

app.get('/api/admin/summary', async (req, res) => {
  try {
    const revenueDay = getCurrentRevenueDayRange();
    const totals = await get(`
      SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(
          CASE
            WHEN status = 'Collected' AND collected_at >= ? AND collected_at < ? THEN total
            ELSE 0
          END
        ), 0) AS revenue,
        SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END) AS delivered
      FROM orders
    `, [revenueDay.start, revenueDay.end]);

    const users = await all(
      'SELECT id, full_name, username, role, email, recovery_whatsapp, wallet_balance_cents, monthly_account_enabled FROM users ORDER BY created_at DESC'
    );

    res.json({
      totals,
      users
    });
  } catch (error) {
    console.error('Error loading admin summary:', error);
    res.status(500).json({ message: 'Unable to load admin summary.' });
  }
});

app.get('/api/admin/monthly-invoices', async (req, res) => {
  const range = getBillingPeriodRange(req.query.period);
  if (!range) {
    return res.status(400).json({ message: 'Choose a billing month in YYYY-MM format.' });
  }

  try {
    const invoices = await all(
      `SELECT i.id, i.user_id, i.billing_period, i.total_cents, i.status,
              i.created_at, i.paid_at, u.full_name, u.username
       FROM monthly_invoices i
       JOIN users u ON u.id = i.user_id
       WHERE i.billing_period = ?
       ORDER BY CASE i.status WHEN 'unpaid' THEN 0 ELSE 1 END, u.full_name, i.id`,
      [range.period]
    );
    if (invoices.length) {
      const invoiceOrders = await all(
        `SELECT mio.invoice_id, o.id AS order_id, o.total, o.status, o.created_at
         FROM monthly_invoice_orders mio
         JOIN orders o ON o.id = mio.order_id
         WHERE mio.invoice_id IN (${invoices.map(() => '?').join(', ')})
         ORDER BY o.created_at, o.id`,
        invoices.map((invoice) => invoice.id)
      );
      const ordersByInvoice = new Map();
      for (const order of invoiceOrders) {
        const key = String(order.invoice_id);
        const orders = ordersByInvoice.get(key) || [];
        orders.push(order);
        ordersByInvoice.set(key, orders);
      }
      invoices.forEach((invoice) => {
        invoice.orders = ordersByInvoice.get(String(invoice.id)) || [];
        invoice.total_cents = Number(invoice.total_cents);
      });
    }
    res.json({ period: range.period, invoices });
  } catch (error) {
    console.error('Error loading monthly invoices:', error);
    res.status(500).json({ message: 'Unable to load monthly invoices.' });
  }
});

app.post('/api/admin/monthly-invoices/generate', async (req, res) => {
  const range = getBillingPeriodRange(req.body.period);
  if (!range) {
    return res.status(400).json({ message: 'Choose a billing month in YYYY-MM format.' });
  }
  if (!range.isClosed) {
    return res.status(400).json({ message: 'Statements can only be generated for a month that has ended.' });
  }

  try {
    const result = await withTransaction(async (transaction) => {
      const eligibleOrders = await transaction.all(
        `SELECT o.id, o.user_id, o.total
         FROM orders o
         WHERE o.payment_method = 'monthly'
           AND o.status IN ('Collected', 'Delivered')
           AND o.user_id IS NOT NULL
           AND o.created_at >= ? AND o.created_at < ?
           AND NOT EXISTS (
             SELECT 1 FROM monthly_invoice_orders mio WHERE mio.order_id = o.id
           )
         ORDER BY o.user_id, o.id`,
        [range.start, range.end]
      );
      const ordersByClient = new Map();
      for (const order of eligibleOrders) {
        const key = String(order.user_id);
        const orders = ordersByClient.get(key) || [];
        const totalCents = Math.round(Number(order.total) * 100);
        if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
          throw new Error(`Order ${order.id} has an invalid total and cannot be invoiced.`);
        }
        orders.push({ id: order.id, totalCents });
        ordersByClient.set(key, orders);
      }

      let statementsUpdated = 0;
      for (const [userId, orders] of ordersByClient) {
        let invoice = await transaction.get(
          `SELECT id, total_cents
           FROM monthly_invoices
           WHERE user_id = ? AND billing_period = ? AND status = 'unpaid'
           ORDER BY id DESC
           LIMIT 1`,
          [userId, range.period]
        );
        if (!invoice) {
          const createdInvoice = await transaction.run(
            `INSERT INTO monthly_invoices (user_id, billing_period, created_by)
             VALUES (?, ?, ?)`,
            [userId, range.period, req.adminUser.id]
          );
          invoice = { id: createdInvoice.id, total_cents: 0 };
        }

        let addedCents = 0;
        for (const order of orders) {
          addedCents += order.totalCents;
          await transaction.run(
            'INSERT INTO monthly_invoice_orders (invoice_id, order_id) VALUES (?, ?)',
            [invoice.id, order.id]
          );
        }
        const updatedCents = Number(invoice.total_cents) + addedCents;
        if (!Number.isSafeInteger(updatedCents)) {
          throw new Error(`Invoice for client ${userId} exceeds the supported total.`);
        }
        await transaction.run(
          'UPDATE monthly_invoices SET total_cents = ? WHERE id = ? AND status = \'unpaid\'',
          [updatedCents, invoice.id]
        );
        statementsUpdated += 1;
      }
      return { statementsUpdated, ordersAdded: eligibleOrders.length };
    });
    res.json({
      message: result.ordersAdded
        ? `Added ${result.ordersAdded} completed order${result.ordersAdded === 1 ? '' : 's'} to ${result.statementsUpdated} monthly statement${result.statementsUpdated === 1 ? '' : 's'}.`
        : 'No completed, unbilled monthly orders were found for that month.',
      ...result
    });
  } catch (error) {
    console.error('Error generating monthly invoices:', error);
    res.status(500).json({ message: 'Unable to generate monthly statements.' });
  }
});

app.patch('/api/admin/monthly-invoices/:id/pay', async (req, res) => {
  const invoiceId = Number(req.params.id);
  if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) {
    return res.status(400).json({ message: 'Choose a valid monthly statement.' });
  }

  try {
    const result = await withTransaction(async (transaction) => {
      const update = await transaction.run(
        `UPDATE monthly_invoices
         SET status = 'paid', paid_at = CURRENT_TIMESTAMP, paid_by = ?
         WHERE id = ? AND status = 'unpaid'`,
        [req.adminUser.id, invoiceId]
      );
      if (update.changes !== 1) {
        const invoice = await transaction.get('SELECT status FROM monthly_invoices WHERE id = ?', [invoiceId]);
        const error = new Error(invoice ? 'This statement has already been paid.' : 'Monthly statement not found.');
        error.statusCode = invoice ? 409 : 404;
        throw error;
      }
      return transaction.get('SELECT id, status, paid_at FROM monthly_invoices WHERE id = ?', [invoiceId]);
    });
    res.json({ message: 'Monthly statement marked as paid.', invoice: result });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('Error recording monthly invoice payment:', error);
    res.status(500).json({ message: 'Unable to record statement payment.' });
  }
});

app.post('/api/admin/cashiers', async (req, res) => {
  try {
    const fullName = typeof req.body.fullName === 'string' ? req.body.fullName.trim() : '';
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const password = req.body.password;
    if (!fullName || !username || typeof password !== 'string') {
      return res.status(400).json({ message: 'Enter the cashier name, username, and password.' });
    }
    if (password.length < 14) {
      return res.status(400).json({ message: 'Cashier passwords must be at least 14 characters long.' });
    }
    if (username.length > 100 || fullName.length > 255) {
      return res.status(400).json({ message: 'The cashier name or username is too long.' });
    }
    if (await get('SELECT id FROM users WHERE username = ?', [username])) {
      return res.status(409).json({ message: 'That username is already in use.' });
    }

    await run(
      'INSERT INTO users (full_name, username, password, role) VALUES (?, ?, ?, ?)',
      [fullName, username, await hashPassword(password), 'cashier']
    );
    res.status(201).json({ message: `Cashier account created for ${fullName}.` });
  } catch (error) {
    console.error('Error creating cashier account:', error);
    res.status(500).json({ message: 'Unable to create cashier account.' });
  }
});

app.get('/api/cashier/inventory', requireCashierOrAdminApi, async (req, res) => {
  try {
    const items = await all('SELECT id, name, category, stock_quantity FROM menu_items ORDER BY category, name');
    const receipts = await all(
      `SELECT m.id, m.menu_item_id, m.quantity_change, m.type, m.created_at,
              i.name AS item_name, u.full_name AS received_by
       FROM stock_movements m
       JOIN menu_items i ON i.id = m.menu_item_id
       LEFT JOIN users u ON u.id = m.created_by
       WHERE m.type IN ('received', 'used')
       ORDER BY m.id DESC
       LIMIT 20`
    );
    res.json({ items, receipts });
  } catch (error) {
    console.error('Error loading stock inventory:', error);
    res.status(500).json({ message: 'Unable to load stock inventory.' });
  }
});

app.post('/api/cashier/stock-usage', requireCashierOrAdminApi, async (req, res) => {
  try {
    const menuItemId = Number(req.body.menuItemId);
    const quantity = Number(req.body.quantity);
    if (!Number.isSafeInteger(menuItemId) || menuItemId <= 0 ||
        !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1000000) {
      return res.status(400).json({ message: 'Select a menu item and enter a whole-number quantity used.' });
    }

    const item = await withTransaction(async (transaction) => {
      const existing = await transaction.get(
        'SELECT id, name, stock_quantity FROM menu_items WHERE id = ?',
        [menuItemId]
      );
      if (!existing) {
        const error = new Error('That menu item could not be found.');
        error.statusCode = 404;
        throw error;
      }

      const update = await transaction.run(
        'UPDATE menu_items SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?',
        [quantity, menuItemId, quantity]
      );
      if (update.changes !== 1) {
        const error = new Error(`Only ${Number(existing.stock_quantity)} ${existing.name} are currently in stock.`);
        error.statusCode = 409;
        throw error;
      }

      await transaction.run(
        `INSERT INTO stock_movements (menu_item_id, quantity_change, type, created_by)
         VALUES (?, ?, 'used', ?)`,
        [menuItemId, -quantity, req.accountUser.id]
      );
      return transaction.get(
        'SELECT id, name, stock_quantity FROM menu_items WHERE id = ?',
        [menuItemId]
      );
    });

    res.status(201).json({
      message: `Removed ${quantity} ${item.name} from stock.`,
      item
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('Error recording used stock:', error);
    res.status(500).json({ message: 'Unable to subtract used stock.' });
  }
});

app.post('/api/cashier/stock-receipts', requireCashierOrAdminApi, async (req, res) => {
  try {
    const menuItemId = Number(req.body.menuItemId);
    const quantity = Number(req.body.quantity);
    if (!Number.isSafeInteger(menuItemId) || menuItemId <= 0 ||
        !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1000000) {
      return res.status(400).json({ message: 'Select a menu item and enter a whole-number quantity received.' });
    }

    const item = await withTransaction(async (transaction) => {
      const existing = await transaction.get(
        'SELECT id, name, stock_quantity FROM menu_items WHERE id = ?',
        [menuItemId]
      );
      if (!existing) {
        const error = new Error('That menu item could not be found.');
        error.statusCode = 404;
        throw error;
      }
      const update = await transaction.run(
        'UPDATE menu_items SET stock_quantity = stock_quantity + ? WHERE id = ? AND stock_quantity <= ?',
        [quantity, menuItemId, 2147483647 - quantity]
      );
      if (update.changes !== 1) {
        const error = new Error('The resulting stock quantity is too large to save.');
        error.statusCode = 400;
        throw error;
      }
      await transaction.run(
        `INSERT INTO stock_movements (menu_item_id, quantity_change, type, created_by)
         VALUES (?, ?, 'received', ?)`,
        [menuItemId, quantity, req.accountUser.id]
      );
      const updated = await transaction.get(
        'SELECT id, name, stock_quantity FROM menu_items WHERE id = ?',
        [menuItemId]
      );
      return updated;
    });
    res.status(201).json({
      message: `Added ${quantity} ${item.name} to stock.`,
      item
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('Error recording received stock:', error);
    res.status(500).json({ message: 'Unable to record received stock.' });
  }
});

app.get('/api/cashier/students', requireCashierOrAdminApi, async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    if (search.length < 2) {
      return res.status(400).json({ message: 'Enter at least two characters to find a student.' });
    }
    const students = await all(
      `SELECT id, full_name, username, wallet_balance_cents
       FROM users
       WHERE role = 'staff' AND (username LIKE ? OR full_name LIKE ?)
       ORDER BY full_name
       LIMIT 25`,
      [`%${search}%`, `%${search}%`]
    );
    res.json({
      students: students.map((student) => ({
        id: student.id,
        fullName: student.full_name,
        username: student.username,
        balanceCents: Number(student.wallet_balance_cents)
      }))
    });
  } catch (error) {
    console.error('Error searching student accounts:', error);
    res.status(500).json({ message: 'Unable to search student accounts.' });
  }
});

app.post('/api/cashier/deposits', requireCashierOrAdminApi, async (req, res) => {
  try {
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const amount = typeof req.body.amount === 'string' || typeof req.body.amount === 'number'
      ? String(req.body.amount).trim()
      : '';
    if (!username || !/^\d+(?:\.\d{1,2})?$/.test(amount)) {
      return res.status(400).json({ message: 'Select a student and enter a valid deposit amount.' });
    }
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      return res.status(400).json({ message: 'Deposit amount must be greater than zero.' });
    }

    const result = await withTransaction(async (transaction) => {
      const student = await transaction.get(
        "SELECT id, full_name, username FROM users WHERE username = ? AND role = 'staff'",
        [username]
      );
      if (!student) {
        const error = new Error('Student account not found. Check the username and try again.');
        error.statusCode = 404;
        throw error;
      }
      await transaction.run(
        'UPDATE users SET wallet_balance_cents = wallet_balance_cents + ? WHERE id = ?',
        [amountCents, student.id]
      );
      await transaction.run(
        `INSERT INTO account_transactions (user_id, amount_cents, type, created_by)
         VALUES (?, ?, 'deposit', ?)`,
        [student.id, amountCents, req.accountUser.id]
      );
      const updated = await transaction.get(
        'SELECT wallet_balance_cents FROM users WHERE id = ?',
        [student.id]
      );
      return { student, balanceCents: Number(updated.wallet_balance_cents) };
    });
    res.status(201).json({
      message: `Deposited $${(amountCents / 100).toFixed(2)} for ${result.student.full_name}.`,
      student: {
        fullName: result.student.full_name,
        username: result.student.username,
        balanceCents: result.balanceCents
      }
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('Error recording student deposit:', error);
    res.status(500).json({ message: 'Unable to record deposit.' });
  }
});

app.get('/api/cashier/transactions', requireCashierOrAdminApi, async (req, res) => {
  try {
    const students = await all(
      `SELECT full_name, username, wallet_balance_cents AS balance_cents
       FROM users
       WHERE role = 'staff'
       ORDER BY full_name`
    );
    const transactions = await all(
      `SELECT t.id, t.amount_cents, t.type, t.created_at,
              u.full_name AS student_name, u.username AS student_username,
              c.full_name AS recorded_by
       FROM account_transactions t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN users c ON c.id = t.created_by
       ORDER BY t.id DESC
       LIMIT 40`
    );
    const accountsByUsername = new Map(students.map((student) => [
      student.username,
      {
        student_name: student.full_name,
        student_username: student.username,
        balance_cents: Number(student.balance_cents),
        transactions: []
      }
    ]));
    for (const transaction of transactions) {
      accountsByUsername.get(transaction.student_username)?.transactions.push(transaction);
    }
    res.json({ accounts: Array.from(accountsByUsername.values()) });
  } catch (error) {
    console.error('Error loading credit transactions:', error);
    res.status(500).json({ message: 'Unable to load recent credit transactions.' });
  }
});

app.get('/api/admin/revenue', async (req, res) => {
  try {
    const revenueDay = getCurrentRevenueDayRange();
    const sales = await all(`
      SELECT
        o.id AS order_id,
        o.customer_name,
        o.collected_at,
        mi.name AS item_name,
        oi.quantity,
        oi.unit_price
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN menu_items mi ON mi.id = oi.menu_item_id
      WHERE o.status = 'Collected'
        AND o.collected_at >= ?
        AND o.collected_at < ?
      ORDER BY o.collected_at DESC, o.id DESC, mi.name
    `, [revenueDay.start, revenueDay.end]);

    res.json({
      sales: sales.map((sale) => ({
        ...sale,
        quantity: Number(sale.quantity),
        unit_price: Number(sale.unit_price),
        line_total: Number(sale.quantity) * Number(sale.unit_price)
      }))
    });
  } catch (error) {
    console.error('Error loading revenue details:', error);
    res.status(500).json({ message: 'Unable to load purchased items.' });
  }
});

app.post('/api/admin/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ message: 'Enter your current password and a new password.' });
    }
    if (newPassword.length < 14) {
      return res.status(400).json({ message: 'Your new password must be at least 14 characters long.' });
    }
    if (!await verifyPassword(currentPassword, req.adminUser.password)) {
      return res.status(401).json({ message: 'Your current password is incorrect.' });
    }

    const updatedPasswordHash = await hashPassword(newPassword);
    await run(
      'UPDATE users SET password = ?, session_version = session_version + 1 WHERE id = ?',
      [updatedPasswordHash, req.adminUser.id]
    );
    const updatedAdmin = await get(
      'SELECT id, role, password, session_version FROM users WHERE id = ?',
      [req.adminUser.id]
    );
    setAdminSessionCookie(req, res, updatedAdmin);
    res.json({ message: 'Administrator password updated.' });
  } catch (error) {
    console.error('Error changing administrator password:', error);
    res.status(500).json({ message: 'Unable to update administrator password.' });
  }
});

app.get('/api/menu', async (req, res) => {
  try {
    const today = getCurrentMenuDay();
    const menuItems = await all(
      `SELECT mi.*
       FROM menu_items mi
       JOIN menu_schedule ms ON ms.menu_item_id = mi.id
       WHERE ms.day_of_week = ?
       ORDER BY mi.category, mi.id`,
      [today.dayOfWeek]
    );
    res.json({ ...today, items: menuItems });
  } catch (error) {
    console.error('Error fetching menu:', error);
    res.status(500).json({ message: 'Failed to load menu items' });
  }
});

app.get('/api/admin/menu-schedule', async (req, res) => {
  try {
    const menuItems = await all('SELECT * FROM menu_items ORDER BY category, id');
    const schedule = await all('SELECT day_of_week, menu_item_id FROM menu_schedule');
    res.json({
      weekdays: WEEKDAY_NAMES,
      menuItems,
      schedule: schedule.map((entry) => ({
        dayOfWeek: Number(entry.day_of_week),
        menuItemId: Number(entry.menu_item_id)
      }))
    });
  } catch (error) {
    console.error('Error fetching weekly menu schedule:', error);
    res.status(500).json({ message: 'Failed to load weekly menu schedule.' });
  }
});

app.put('/api/admin/menu-schedule', async (req, res) => {
  try {
    const { schedule } = req.body;
    if (!Array.isArray(schedule)) {
      return res.status(400).json({ message: 'A weekly menu schedule is required.' });
    }

    const menuItems = await all('SELECT id FROM menu_items');
    const menuItemIds = new Set(menuItems.map((item) => Number(item.id)));
    const entries = [];
    const seen = new Set();

    for (const assignment of schedule) {
      if (!assignment || typeof assignment !== 'object') {
        return res.status(400).json({ message: 'The schedule contains an invalid meal assignment.' });
      }

      const dayOfWeek = Number(assignment.dayOfWeek);
      const menuItemId = Number(assignment.menuItemId);
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6 || !menuItemIds.has(menuItemId)) {
        return res.status(400).json({ message: 'The schedule contains an invalid weekday or menu item.' });
      }

      const key = `${dayOfWeek}:${menuItemId}`;
      if (seen.has(key)) {
        return res.status(400).json({ message: 'The schedule contains a duplicate meal assignment.' });
      }
      seen.add(key);
      entries.push({ dayOfWeek, menuItemId });
    }

    if (entries.length === 0) {
      return res.status(400).json({ message: 'Schedule at least one meal before saving.' });
    }

    await replaceMenuSchedule(entries);
    res.json({ message: 'Weekly menu schedule saved.' });
  } catch (error) {
    console.error('Error saving weekly menu schedule:', error);
    res.status(500).json({ message: 'Failed to save weekly menu schedule.' });
  }
});

app.get('/api/orders', requireAdminApi, async (req, res) => {
  try {
    const orders = await all('SELECT * FROM orders ORDER BY created_at DESC');
    const results = [];

    for (const order of orders) {
      const items = await all(
        `SELECT oi.*, mi.name AS item_name, mi.description
         FROM order_items oi
         JOIN menu_items mi ON mi.id = oi.menu_item_id
         WHERE oi.order_id = ?`,
        [order.id]
      );
      results.push({ ...order, items });
    }

    res.json(results);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ message: 'Failed to load orders' });
  }
});

app.post('/api/orders', requireStudentApi, async (req, res) => {
  try {
    const { phone, address, note, items, orderType, paymentMethod } = req.body;
    if (!['cash', 'credit', 'monthly'].includes(paymentMethod)) {
      return res.status(400).json({ message: 'Choose cash, student credit, or monthly billing to place the order.' });
    }
    const selectedOrderType = String(orderType || 'pickup').toLowerCase();
    const isDelivery = selectedOrderType === 'delivery';

    if (isDelivery) {
      return res.status(400).json({
        message: 'We’re sorry, but delivery is temporarily unavailable while we arrange our motorbike. Please choose pickup. Thank you for your understanding!'
      });
    }

    if (typeof phone !== 'string' || !phone.trim() || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Please complete the form and select at least one item.' });
    }

    if (isDelivery && (!address || !String(address).trim())) {
      return res.status(400).json({ message: 'Delivery address is required when delivery is selected.' });
    }

    const finalAddress = isDelivery ? String(address).trim() : 'Pickup';

    const today = getCurrentMenuDay();
    const menuItems = await all(
      `SELECT mi.*
       FROM menu_items mi
       JOIN menu_schedule ms ON ms.menu_item_id = mi.id
       WHERE ms.day_of_week = ?`,
      [today.dayOfWeek]
    );
    const menuMap = new Map(menuItems.map(item => [Number(item.id), item]));

    let totalCents = isDelivery ? 350 : 0;
    const orderItems = [];

    for (const item of items) {
      const menuItem = menuMap.get(Number(item.id));
      if (!menuItem) {
        return res.status(400).json({ message: `Menu item ${item.id} is not available.` });
      }

      const quantity = Number(item.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        return res.status(400).json({ message: 'Each item must have a quantity greater than zero.' });
      }

      const unitPriceCents = Math.round(Number(menuItem.price) * 100);
      if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0 ||
          !Number.isSafeInteger(unitPriceCents * quantity)) {
        return res.status(400).json({ message: 'The order total is invalid.' });
      }
      totalCents += unitPriceCents * quantity;
      orderItems.push({
        menu_item_id: menuItem.id,
        quantity,
        unit_price: menuItem.price,
      });
    }

    if (!Number.isSafeInteger(totalCents)) {
      return res.status(400).json({ message: 'The order total is invalid.' });
    }
    const orderResult = await withTransaction(async (transaction) => {
      if (paymentMethod === 'monthly') {
        const client = await transaction.get(
          "SELECT monthly_account_enabled FROM users WHERE id = ? AND role = 'staff'",
          [req.accountUser.id]
        );
        if (!client || !client.monthly_account_enabled) {
          const error = new Error('Monthly billing is available only to clients approved by an administrator.');
          error.statusCode = 403;
          throw error;
        }
      }
      const orderResult = await transaction.run(
        `INSERT INTO orders (user_id, customer_name, phone, address, note, total, payment_method, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')`,
        [
          req.accountUser.id,
          req.accountUser.full_name,
          String(phone).trim(),
          finalAddress,
          typeof note === 'string' ? note : '',
          (totalCents / 100).toFixed(2),
          paymentMethod
        ]
      );
      for (const orderItem of orderItems) {
        const stockUpdate = await transaction.run(
          'UPDATE menu_items SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?',
          [orderItem.quantity, orderItem.menu_item_id, orderItem.quantity]
        );
        if (stockUpdate.changes !== 1) {
          const menuItem = await transaction.get(
            'SELECT name, stock_quantity FROM menu_items WHERE id = ?',
            [orderItem.menu_item_id]
          );
          const error = new Error(
            menuItem
              ? `Not enough ${menuItem.name} in stock. Only ${Number(menuItem.stock_quantity)} available.`
              : 'A menu item in this order is no longer available.'
          );
          error.statusCode = 409;
          throw error;
        }
        await transaction.run(
          `INSERT INTO stock_movements (menu_item_id, quantity_change, type, order_id)
           VALUES (?, ?, 'sale', ?)`,
          [orderItem.menu_item_id, -orderItem.quantity, orderResult.id]
        );
        await transaction.run(
          'INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
          [orderResult.id, orderItem.menu_item_id, orderItem.quantity, orderItem.unit_price]
        );
      }
      if (paymentMethod === 'credit') {
        const debit = await transaction.run(
          `UPDATE users
           SET wallet_balance_cents = wallet_balance_cents - ?
           WHERE id = ? AND wallet_balance_cents >= ?`,
          [totalCents, req.accountUser.id, totalCents]
        );
        if (debit.changes !== 1) {
          const student = await transaction.get(
            'SELECT wallet_balance_cents FROM users WHERE id = ?',
            [req.accountUser.id]
          );
          const error = new Error(
            `Not enough credit. This order costs $${(totalCents / 100).toFixed(2)}; ` +
            `your balance is $${(Number(student.wallet_balance_cents) / 100).toFixed(2)}.`
          );
          error.statusCode = 402;
          throw error;
        }
        const student = await transaction.get(
          'SELECT wallet_balance_cents FROM users WHERE id = ?',
          [req.accountUser.id]
        );
        await transaction.run(
          `INSERT INTO account_transactions (user_id, amount_cents, type, order_id)
           VALUES (?, ?, 'purchase', ?)`,
          [req.accountUser.id, -totalCents, orderResult.id]
        );
        const order = await transaction.get('SELECT * FROM orders WHERE id = ?', [orderResult.id]);
        return { order, balanceCents: Number(student.wallet_balance_cents) };
      }
      const order = await transaction.get('SELECT * FROM orders WHERE id = ?', [orderResult.id]);
      const student = await transaction.get(
        'SELECT wallet_balance_cents FROM users WHERE id = ?',
        [req.accountUser.id]
      );
      return { order, balanceCents: Number(student.wallet_balance_cents) };
    });
    const createdItems = await all(
      `SELECT oi.*, mi.name AS item_name
       FROM order_items oi
       JOIN menu_items mi ON mi.id = oi.menu_item_id
       WHERE oi.order_id = ?`,
      [orderResult.order.id]
    );

    res.status(201).json({
      message: 'Order placed successfully.',
      order: { ...orderResult.order, items: createdItems },
      balanceCents: orderResult.balanceCents
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('Error creating order:', error);
    res.status(500).json({ message: 'Failed to place order.' });
  }
});

app.patch('/api/orders/:id/status', requireCashierOrAdminApi, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['Pending', 'Preparing', 'Ready for Pickup', 'Out for Delivery', 'Delivered', 'Collected', 'Cancelled'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status provided.' });
    }

    const updatedOrder = await withTransaction(async (transaction) => {
      const order = await transaction.get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
      if (!order) {
        const error = new Error('Order not found.');
        error.statusCode = 404;
        throw error;
      }
      if (order.status === status) return order;
      if (order.status === 'Cancelled') {
        const error = new Error('A cancelled order cannot be changed.');
        error.statusCode = 409;
        throw error;
      }
      if (['Collected', 'Delivered'].includes(order.status)) {
        const error = new Error('A completed order cannot be changed.');
        error.statusCode = 409;
        throw error;
      }
      if (status === 'Collected' && !['Pending', 'Preparing', 'Ready for Pickup'].includes(order.status)) {
        const error = new Error('Only an active pickup order can be marked collected.');
        error.statusCode = 409;
        throw error;
      }
      const update = status === 'Collected'
        ? await transaction.run(
          'UPDATE orders SET status = ?, collected_at = ? WHERE id = ? AND status = ?',
          [status, new Date().toISOString().slice(0, 19).replace('T', ' '), req.params.id, order.status]
        )
        : await transaction.run(
          'UPDATE orders SET status = ? WHERE id = ? AND status = ?',
          [status, req.params.id, order.status]
        );
      if (update.changes !== 1) {
        const error = new Error('The order changed before this update. Refresh and try again.');
        error.statusCode = 409;
        throw error;
      }
      if (status === 'Cancelled') {
        const soldStock = await transaction.all(
          `SELECT menu_item_id, quantity_change
           FROM stock_movements
           WHERE order_id = ? AND type = 'sale'`,
          [order.id]
        );
        for (const movement of soldStock) {
          const returnedQuantity = -Number(movement.quantity_change);
          await transaction.run(
            'UPDATE menu_items SET stock_quantity = stock_quantity + ? WHERE id = ?',
            [returnedQuantity, movement.menu_item_id]
          );
          await transaction.run(
            `INSERT INTO stock_movements (menu_item_id, quantity_change, type, order_id, created_by)
             VALUES (?, ?, 'return', ?, ?)`,
            [movement.menu_item_id, returnedQuantity, order.id, req.accountUser.id]
          );
        }
      }
      if (status === 'Cancelled' && order.user_id && order.payment_method === 'credit') {
        const refundCents = Math.round(Number(order.total) * 100);
        await transaction.run(
          'UPDATE users SET wallet_balance_cents = wallet_balance_cents + ? WHERE id = ?',
          [refundCents, order.user_id]
        );
        await transaction.run(
          `INSERT INTO account_transactions (user_id, amount_cents, type, order_id, created_by)
           VALUES (?, ?, 'refund', ?, ?)`,
          [order.user_id, refundCents, order.id, req.accountUser.id]
        );
      }
      return transaction.get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    });
    res.json({ message: 'Order status updated.', order: updatedOrder });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('Error updating status:', error);
    res.status(500).json({ message: 'Failed to update order status.' });
  }
});

app.get('/api/restaurant/orders', requireCashierOrAdminApi, async (req, res) => {
  try {
    const orders = await all('SELECT * FROM orders ORDER BY created_at DESC');
    const result = [];

    for (const order of orders) {
      const items = await all(
        `SELECT oi.*, mi.name AS item_name
         FROM order_items oi
         JOIN menu_items mi ON mi.id = oi.menu_item_id
         WHERE oi.order_id = ?`,
        [order.id]
      );
      result.push({ ...order, items });
    }

    res.json(result);
  } catch (error) {
    console.error('Error fetching restaurant orders:', error);
    res.status(500).json({ message: 'unable to load restaurant orders' });
  }
});

app.get('/api/delivery/orders', requireCashierOrAdminApi, async (req, res) => {
  try {
    const orders = await all('SELECT * FROM orders WHERE status IN ("Preparing", "Ready for Pickup", "Out for Delivery", "Delivered") ORDER BY created_at DESC');
    const result = [];

    for (const order of orders) {
      const items = await all(
        `SELECT oi.*, mi.name AS item_name
         FROM order_items oi
         JOIN menu_items mi ON mi.id = oi.menu_item_id
         WHERE oi.order_id = ?`,
        [order.id]
      );
      result.push({ ...order, items });
    }

    res.json(result);
  } catch (error) {
    console.error('Error fetching delivery orders:', error);
    res.status(500).json({ message: 'unable to load delivery orders' });
  }
});

app.get('*', (req, res) => {
  const fileName = req.path.replace(/^\//, '');
  const safeFilePath = path.join(__dirname, 'public', fileName || 'login.html');
  res.sendFile(safeFilePath);
});

async function startServer() {
  await initializeDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Network access: http://YOUR_PC_IP:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
