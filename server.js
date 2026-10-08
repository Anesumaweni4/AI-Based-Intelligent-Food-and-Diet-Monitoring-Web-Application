const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { initializeDatabase, get, all, run, withTransaction, replaceMenuSchedule } = require('./db');
const { hashPassword, verifyPassword, passwordNeedsRehash } = require('./passwords');

const app = express();
const PORT = process.env.PORT || 3000;
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ADMIN_SESSION_COOKIE = 'foodieAdminSession';
const ADMIN_GATE_COOKIE = 'foodieAdminGate';
const ACCOUNT_SESSION_COOKIE = 'foodieAccountSession';
const ADMIN_SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const ADMIN_GATE_DURATION_MS = 5 * 60 * 1000;
const ADMIN_GATE_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_GATE_MAX_ATTEMPTS = 10;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const adminGateAttempts = new Map();

if (SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters long.');
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

function signAdminGate() {
  const payload = Buffer.from(JSON.stringify({
    expiresAt: Date.now() + ADMIN_GATE_DURATION_MS
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function hasValidAdminGate(req) {
  const token = getCookie(req, ADMIN_GATE_COOKIE);
  if (!token) return false;

  const [payload, providedSignature, extra] = token.split('.');
  if (!payload || !providedSignature || extra !== undefined) return false;

  const expectedSignature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest();
  const actualSignature = Buffer.from(providedSignature, 'base64url');
  if (actualSignature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(actualSignature, expectedSignature)) {
    return false;
  }

  try {
    const gate = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isSafeInteger(gate.expiresAt) &&
      gate.expiresAt > Date.now() &&
      gate.expiresAt <= Date.now() + ADMIN_GATE_DURATION_MS;
  } catch {
    return false;
  }
}

function setAdminGateCookie(res) {
  res.cookie(ADMIN_GATE_COOKIE, signAdminGate(), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_GATE_DURATION_MS
  });
}

function clearAdminGateCookie(req, res) {
  res.clearCookie(ADMIN_GATE_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  });
}

function safeCredentialMatch(provided, configured) {
  const providedHash = crypto.createHash('sha256').update(provided).digest();
  const configuredHash = crypto.createHash('sha256').update(configured).digest();
  return crypto.timingSafeEqual(providedHash, configuredHash);
}

function getGateAttemptState(ipAddress) {
  const now = Date.now();
  const existing = adminGateAttempts.get(ipAddress);
  if (!existing || now - existing.startedAt >= ADMIN_GATE_ATTEMPT_WINDOW_MS) {
    const fresh = { startedAt: now, count: 0 };
    adminGateAttempts.set(ipAddress, fresh);
    return fresh;
  }
  return existing;
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
app.get('/admin-login.html', (req, res) => {
  if (!hasValidAdminGate(req)) {
    return res.redirect('/login.html');
  }
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
      return res.redirect('/cashier-login.html');
    }
    res.sendFile(path.join(__dirname, 'public', 'cashier.html'));
  } catch (error) {
    console.error('Error verifying cashier page access:', error);
    res.status(500).send('Unable to verify cashier access.');
  }
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

app.get('/home', (req, res) => {
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
    clearAdminGateCookie(req, res);
    clearAccountSessionCookie(req, res);
    res.json({ message: 'Logged out.' });
  } catch (error) {
    console.error('Error logging out administrator:', error);
    res.status(500).json({ message: 'Unable to safely end the administrator session.' });
  }
});

app.post('/api/admin/gate', (req, res) => {
  const configuredUsername = process.env.ADMIN_GATE_USERNAME;
  const configuredPassword = process.env.ADMIN_GATE_PASSWORD;
  if (!configuredUsername || !configuredPassword) {
    return res.status(503).json({ message: 'Admin login access is not configured on the server.' });
  }

  const state = getGateAttemptState(req.ip);
  if (state.count >= ADMIN_GATE_MAX_ATTEMPTS) {
    return res.status(429).json({ message: 'Too many attempts. Please try again in 15 minutes.' });
  }

  const { username, password } = req.body;
  const credentialsMatch = typeof username === 'string' &&
    typeof password === 'string' &&
    safeCredentialMatch(username, configuredUsername) &&
    safeCredentialMatch(password, configuredPassword);

  if (!credentialsMatch) {
    state.count += 1;
    return res.status(401).json({ message: 'Those admin access details are incorrect.' });
  }

  adminGateAttempts.delete(req.ip);
  setAdminGateCookie(res);
  res.json({ message: 'Access verified.' });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { fullName, username, password, age, weight, height } = req.body;

    if (!fullName || !username || !password) {
      return res.status(400).json({ message: 'Full name, username, and password are required.' });
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

    const user = await run(
      'INSERT INTO users (full_name, username, password, role, age, weight, height) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [fullName.trim(), username.trim(), await hashPassword(password), 'staff', parsedAge, parsedWeight, parsedHeight]
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

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const requestedRole = String(role || 'user').toLowerCase();

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }

    if (requestedRole === 'admin' && !hasValidAdminGate(req)) {
      return res.status(403).json({ message: 'Complete the admin access check before signing in.' });
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

    if (passwordNeedsRehash(user.password)) {
      user.password = await hashPassword(password);
      await run('UPDATE users SET password = ? WHERE id = ?', [user.password, user.id]);
    }

    if (user.role === 'admin') {
      setAdminSessionCookie(req, res, user);
    } else {
      clearAdminSessionCookie(req, res);
      clearAdminGateCookie(req, res);
      setAccountSessionCookie(res, user);
    }

    res.json({
      message: 'Login successful.',
      user: {
        id: user.id,
        fullName: user.full_name,
        username: user.username,
        age: user.age,
        weight: user.weight,
        height: user.height,
        walletBalanceCents: Number(user.wallet_balance_cents || 0),
        role: user.role
      }
    });

  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ message: 'Login failed.' });
  }
});

app.get('/api/account', requireStudentApi, async (req, res) => {
  try {
    const user = await get(
      'SELECT id, full_name, username, wallet_balance_cents FROM users WHERE id = ?',
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
    res.json({
      user: {
        id: user.id,
        fullName: user.full_name,
        username: user.username,
        balanceCents: Number(user.wallet_balance_cents)
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
    res.json(orders);
  } catch (error) {
    console.error('Error loading student orders:', error);
    res.status(500).json({ message: 'Unable to load your order updates.' });
  }
});

app.use('/api/admin', requireAdminApi);

app.get('/api/admin/summary', async (req, res) => {
  try {
    const totals = await get(`
      SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(CASE WHEN status != 'Cancelled' THEN total ELSE 0 END), 0) AS revenue,
        SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END) AS delivered
      FROM orders
    `);

    const users = await all(
      'SELECT id, full_name, username, role, wallet_balance_cents FROM users ORDER BY created_at DESC'
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
    res.json({ transactions });
  } catch (error) {
    console.error('Error loading credit transactions:', error);
    res.status(500).json({ message: 'Unable to load recent credit transactions.' });
  }
});

app.get('/api/admin/revenue', async (req, res) => {
  try {
    const sales = await all(`
      SELECT
        o.id AS order_id,
        o.customer_name,
        o.created_at,
        mi.name AS item_name,
        oi.quantity,
        oi.unit_price
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN menu_items mi ON mi.id = oi.menu_item_id
      WHERE o.status != 'Cancelled'
      ORDER BY o.created_at DESC, o.id DESC, mi.name
    `);

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
    if (!['cash', 'credit'].includes(paymentMethod)) {
      return res.status(400).json({ message: 'Choose cash or use your student credit to place the order.' });
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
    const menuMap = new Map(menuItems.map(item => [item.id, item]));

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
      if (status === 'Collected' && order.status !== 'Ready for Pickup') {
        const error = new Error('An order must be ready for pickup before it can be marked collected.');
        error.statusCode = 409;
        throw error;
      }
      const update = await transaction.run(
        'UPDATE orders SET status = ? WHERE id = ? AND status = ?',
        [status, req.params.id, order.status]
      );
      if (update.changes !== 1) {
        const error = new Error('The order changed before this update. Refresh and try again.');
        error.statusCode = 409;
        throw error;
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
