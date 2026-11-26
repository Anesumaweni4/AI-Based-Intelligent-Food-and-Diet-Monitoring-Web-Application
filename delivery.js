// Delivery: riders accept jobs, pick them up from the kitchen, share their live
// location while on the way, and hand over the meal with the student's 4-digit
// code. Students see each step on a map and get a phone notification.
const crypto = require('crypto');
const { get, all, run, withTransaction } = require('./db');
const reminders = require('./reminders');

const DELIVERY_FEE_CENTS = Math.max(0, Math.round(Number(process.env.DELIVERY_FEE ?? 3.5) * 100));
const RIDER_SPEED_KMH = Number(process.env.RIDER_SPEED_KMH) || 22; // motorbike in town traffic
const LOCATION_FRESH_MS = 3 * 60 * 1000;
const KITCHEN = (() => {
  const lat = Number(process.env.KITCHEN_LAT);
  const lng = Number(process.env.KITCHEN_LNG);
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng) ? { lat, lng } : null;
})();

// After this many wrong delivery codes the order is locked for riders and
// cashiers; an administrator unlocks it by giving the order to a rider.
const MAX_DELIVERY_CODE_ATTEMPTS = 5;

const utcNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function newDeliveryCode() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

function parseCoordinate(value, limit) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? Math.round(number * 1e6) / 1e6 : undefined;
}

function distanceKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// Straight-line distance x 1.3 for real roads, at an average town speed, plus a minute to park.
function etaMinutes(from, to) {
  if (!from || !to) return null;
  const km = distanceKm(from, to) * 1.3;
  return Math.max(1, Math.round((km / RIDER_SPEED_KMH) * 60 + 1));
}

// node-postgres returns TIMESTAMP columns as Date (read as local time); orders store UTC wall time.
function storedUtcToMs(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), value.getHours(), value.getMinutes(), value.getSeconds());
  }
  const text = String(value);
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
}

const point = (lat, lng) => (lat === null || lat === undefined || lng === null || lng === undefined ? null : { lat: Number(lat), lng: Number(lng) });

// ---------------------------------------------------------------------------
// Phone notifications for each step of an order
// ---------------------------------------------------------------------------
function statusMessage(order) {
  const id = `#${order.id}`;
  const delivery = order.order_type === 'delivery';
  switch (order.status) {
    case 'Preparing':
      return { title: `Order ${id} is being prepared 👩‍🍳`, body: delivery ? 'The kitchen is cooking your meal. We will tell you when the rider leaves.' : 'The kitchen is cooking your meal. We will tell you when it is ready to collect.' };
    case 'Ready for Pickup':
      return delivery
        ? { title: `Order ${id} is packed 📦`, body: 'Your meal is ready and waiting for the rider.' }
        : { title: `Order ${id} is ready to collect ✅`, body: 'Come to the kitchen counter to collect your meal while it is hot.' };
    case 'Out for Delivery':
      return { title: `Order ${id} is on its way 🛵`, body: `Track the rider live on the map. Your delivery code is ${order.delivery_code}. Give it to the rider when the meal arrives.` };
    case 'Delivered':
      return { title: `Order ${id} delivered 🎉`, body: 'Enjoy your meal! It has been added to your diet diary.' };
    case 'Collected':
      return { title: `Order ${id} collected 🎉`, body: 'Enjoy your meal! It has been added to your diet diary.' };
    case 'Cancelled':
      return { title: `Order ${id} was cancelled`, body: order.payment_method === 'credit' ? 'Your student credit has been refunded.' : 'Please contact the kitchen if you have questions.' };
    default:
      return null;
  }
}

function notifyOrder(order) {
  if (!order || !order.user_id) return;
  const message = statusMessage(order);
  if (!message) return;
  reminders.sendToUser(Number(order.user_id), {
    ...message,
    url: order.order_type === 'delivery' && order.status === 'Out for Delivery' ? `/home.html#track-${order.id}` : '/home.html#orders',
    tag: `order-${order.id}`
  }).catch((error) => console.error('Order notification failed:', error));
}

// ---------------------------------------------------------------------------
// Rider jobs
// ---------------------------------------------------------------------------
async function orderItems(orderIds) {
  if (!orderIds.length) return new Map();
  const rows = await all(
    `SELECT oi.order_id, oi.quantity, mi.name AS item_name
     FROM order_items oi JOIN menu_items mi ON mi.id = oi.menu_item_id
     WHERE oi.order_id IN (${orderIds.map(() => '?').join(', ')}) ORDER BY oi.id`,
    orderIds
  );
  const byOrder = new Map();
  for (const row of rows) {
    const list = byOrder.get(Number(row.order_id)) || [];
    list.push({ name: row.item_name, quantity: Number(row.quantity) });
    byOrder.set(Number(row.order_id), list);
  }
  return byOrder;
}

function jobView(order, items, riderId) {
  const destination = point(order.delivery_lat, order.delivery_lng);
  return {
    id: Number(order.id),
    status: order.status,
    customerName: order.customer_name,
    phone: order.phone,
    address: order.address,
    note: order.note || '',
    total: Number(order.total),
    paymentMethod: order.payment_method,
    collectCash: order.payment_method === 'cash' ? Number(order.total) : 0,
    createdAt: order.created_at,
    destination,
    mine: Number(order.rider_id) === Number(riderId),
    riderId: order.rider_id ? Number(order.rider_id) : null,
    items: items.get(Number(order.id)) || []
  };
}

async function riderJobs(riderId) {
  const open = await all(
    `SELECT * FROM orders
     WHERE order_type = 'delivery' AND status IN ('Pending', 'Preparing', 'Ready for Pickup') AND rider_id IS NULL
     ORDER BY id`
  );
  const mine = await all(
    `SELECT * FROM orders
     WHERE order_type = 'delivery' AND rider_id = ? AND status IN ('Pending', 'Preparing', 'Ready for Pickup', 'Out for Delivery')
     ORDER BY id`,
    [riderId]
  );
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const done = await get(
    "SELECT COUNT(*) AS count, COALESCE(SUM(delivery_fee), 0) AS fees FROM orders WHERE rider_id = ? AND status = 'Delivered' AND delivered_at >= ?",
    [riderId, since]
  );
  const items = await orderItems([...open, ...mine].map((order) => Number(order.id)));
  return {
    kitchen: KITCHEN,
    available: open.map((order) => jobView(order, items, riderId)),
    mine: mine.map((order) => jobView(order, items, riderId)),
    deliveredToday: Number(done.count) || 0,
    feesToday: Number(done.fees) || 0
  };
}

function fail(status, message) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}

// Checks the student's code inside an open transaction. A wrong code is
// counted (and stays counted, so the caller must commit before reporting it):
// returns null when the code is right, or the error to send otherwise.
async function checkDeliveryCode(tx, order, submittedCode, { exempt = false } = {}) {
  const failures = Number(order.delivery_code_failures) || 0;
  if (!exempt && failures >= MAX_DELIVERY_CODE_ATTEMPTS) {
    return fail(423, 'Too many wrong codes for this order. It is locked; ask an administrator to unlock it.');
  }
  const code = String(submittedCode || '').replace(/\D/g, '');
  if (order.delivery_code && code === String(order.delivery_code)) return null;
  if (!order.delivery_code && exempt) return null;
  await tx.run(
    'UPDATE orders SET delivery_code_failures = COALESCE(delivery_code_failures, 0) + 1 WHERE id = ?',
    [order.id]
  );
  const left = MAX_DELIVERY_CODE_ATTEMPTS - failures - 1;
  if (!exempt && left <= 0) {
    return fail(423, 'Too many wrong codes for this order. It is locked; ask an administrator to unlock it.');
  }
  return fail(400, exempt
    ? "That code is not right. Ask the student for the 4-digit code in their order."
    : `That code is not right. Ask the student for the 4-digit code in their order. ${left} ${left === 1 ? 'try' : 'tries'} left.`);
}

async function changeJob(orderId, riderId, action, body = {}) {
  let codeError = null;
  const order = await withTransaction(async (tx) => {
    const current = await tx.get('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!current || current.order_type !== 'delivery') throw fail(404, 'Delivery order not found.');
    if (['Delivered', 'Collected', 'Cancelled'].includes(current.status)) throw fail(409, `This order is already ${current.status.toLowerCase()}.`);
    const mine = Number(current.rider_id) === Number(riderId);

    if (action === 'accept') {
      if (current.rider_id && !mine) throw fail(409, 'Another rider has already taken this order.');
      if (mine) return current;
      const update = await tx.run('UPDATE orders SET rider_id = ? WHERE id = ? AND rider_id IS NULL', [riderId, orderId]);
      if (update.changes !== 1) throw fail(409, 'Another rider has just taken this order.');
    } else if (action === 'release') {
      if (!mine) throw fail(403, 'This is not your delivery.');
      if (current.status === 'Out for Delivery') throw fail(409, 'You have already picked this order up.');
      await tx.run('UPDATE orders SET rider_id = NULL WHERE id = ? AND rider_id = ?', [orderId, riderId]);
    } else if (action === 'pickup') {
      if (!mine) throw fail(403, 'Accept this order before picking it up.');
      if (current.status !== 'Ready for Pickup') throw fail(409, 'The kitchen has not marked this order ready yet.');
      const update = await tx.run(
        "UPDATE orders SET status = 'Out for Delivery', dispatched_at = ? WHERE id = ? AND status = 'Ready for Pickup'",
        [utcNow(), orderId]
      );
      if (update.changes !== 1) throw fail(409, 'The order changed. Refresh and try again.');
    } else if (action === 'deliver') {
      if (!mine) throw fail(403, 'This is not your delivery.');
      if (current.status !== 'Out for Delivery') throw fail(409, 'Pick the order up before delivering it.');
      codeError = await checkDeliveryCode(tx, current, body.code);
      if (codeError) return null;
      const now = utcNow();
      const update = await tx.run(
        "UPDATE orders SET status = 'Delivered', delivered_at = ?, collected_at = ? WHERE id = ? AND status = 'Out for Delivery'",
        [now, now, orderId]
      );
      if (update.changes !== 1) throw fail(409, 'The order changed. Refresh and try again.');
    } else {
      throw fail(400, 'Unknown action.');
    }
    return tx.get('SELECT * FROM orders WHERE id = ?', [orderId]);
  });
  if (codeError) throw codeError;
  if (['pickup', 'deliver'].includes(action)) notifyOrder(order);
  return order;
}

async function updateRiderLocation(riderId, body) {
  const lat = parseCoordinate(body.lat, 90);
  const lng = parseCoordinate(body.lng, 180);
  if (lat === undefined || lng === undefined || lat === null || lng === null) throw fail(400, 'Invalid location.');
  const result = await run(
    "UPDATE orders SET rider_lat = ?, rider_lng = ?, rider_location_at = ? WHERE rider_id = ? AND status IN ('Ready for Pickup', 'Out for Delivery', 'Preparing', 'Pending')",
    [lat, lng, utcNow(), riderId]
  );
  return { updated: result.changes || 0 };
}

// ---------------------------------------------------------------------------
// Student tracking
// ---------------------------------------------------------------------------
async function trackOrder(orderId, userId) {
  const order = await get('SELECT * FROM orders WHERE id = ? AND user_id = ?', [orderId, userId]);
  if (!order) return null;
  const rider = order.rider_id ? await get('SELECT full_name FROM users WHERE id = ?', [order.rider_id]) : null;
  const locationAt = storedUtcToMs(order.rider_location_at);
  const fresh = locationAt && Date.now() - locationAt < LOCATION_FRESH_MS;
  const riderPoint = order.status === 'Out for Delivery' && fresh ? point(order.rider_lat, order.rider_lng) : null;
  const destination = point(order.delivery_lat, order.delivery_lng);
  const steps = order.order_type === 'delivery'
    ? ['Pending', 'Preparing', 'Ready for Pickup', 'Out for Delivery', 'Delivered']
    : ['Pending', 'Preparing', 'Ready for Pickup', 'Collected'];
  return {
    id: Number(order.id),
    status: order.status,
    orderType: order.order_type,
    steps,
    address: order.address,
    deliveryFee: Number(order.delivery_fee) || 0,
    deliveryCode: order.order_type === 'delivery' && order.status !== 'Delivered' && order.status !== 'Cancelled' ? order.delivery_code : null,
    rider: rider ? { name: String(rider.full_name).split(/\s+/)[0] } : null,
    riderLocation: riderPoint,
    riderLocationAgeSec: locationAt ? Math.round((Date.now() - locationAt) / 1000) : null,
    destination,
    kitchen: KITCHEN,
    etaMinutes: riderPoint && destination ? etaMinutes(riderPoint, destination) : null,
    distanceKm: riderPoint && destination ? Math.round(distanceKm(riderPoint, destination) * 10) / 10 : null
  };
}

// ---------------------------------------------------------------------------
// Admin: every delivery order, the riders and today's totals
// ---------------------------------------------------------------------------
const ACTIVE_STATUSES = ['Pending', 'Preparing', 'Ready for Pickup', 'Out for Delivery'];

// Orders store UTC wall time; "today" means since midnight in Harare (UTC+2).
function startOfHarareDayUtc() {
  const harare = new Date(Date.now() + 2 * 3600 * 1000);
  const midnightUtc = Date.UTC(harare.getUTCFullYear(), harare.getUTCMonth(), harare.getUTCDate()) - 2 * 3600 * 1000;
  return new Date(midnightUtc).toISOString().slice(0, 19).replace('T', ' ');
}

async function adminBoard(view = 'active') {
  const since = startOfHarareDayUtc();
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');
  let orders;
  if (view === 'today') {
    orders = await all("SELECT * FROM orders WHERE order_type = 'delivery' AND created_at >= ? ORDER BY id DESC", [since]);
  } else if (view === 'all') {
    orders = await all("SELECT * FROM orders WHERE order_type = 'delivery' ORDER BY id DESC LIMIT 200");
  } else {
    orders = await all(`SELECT * FROM orders WHERE order_type = 'delivery' AND status IN (${placeholders}) ORDER BY id`, ACTIVE_STATUSES);
  }

  const riderRows = await all("SELECT id, full_name, username FROM users WHERE role = 'rider' ORDER BY full_name");
  const activeRows = await all(
    `SELECT rider_id, status, rider_location_at FROM orders
     WHERE order_type = 'delivery' AND rider_id IS NOT NULL AND status IN (${placeholders})`,
    ACTIVE_STATUSES
  );
  const doneRows = await all(
    "SELECT rider_id, COUNT(*) AS count, COALESCE(SUM(delivery_fee), 0) AS fees FROM orders WHERE order_type = 'delivery' AND status = 'Delivered' AND delivered_at >= ? GROUP BY rider_id",
    [since]
  );
  const todayTotals = await get(
    `SELECT COUNT(*) AS placed,
            SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END) AS delivered,
            COALESCE(SUM(CASE WHEN status = 'Delivered' THEN delivery_fee ELSE 0 END), 0) AS fees
     FROM orders WHERE order_type = 'delivery' AND created_at >= ?`,
    [since]
  );
  const allActive = await all(`SELECT status, rider_id, payment_method, total FROM orders WHERE order_type = 'delivery' AND status IN (${placeholders})`, ACTIVE_STATUSES);

  const names = new Map(riderRows.map((rider) => [Number(rider.id), rider.full_name]));
  // Cashiers or admins may also have taken a job from the rider app.
  const otherIds = [...new Set(orders.map((order) => Number(order.rider_id)).filter((id) => id && !names.has(id)))];
  if (otherIds.length) {
    const others = await all(`SELECT id, full_name FROM users WHERE id IN (${otherIds.map(() => '?').join(', ')})`, otherIds);
    others.forEach((user) => names.set(Number(user.id), user.full_name));
  }

  const riders = riderRows.map((rider) => {
    const id = Number(rider.id);
    const jobs = activeRows.filter((row) => Number(row.rider_id) === id);
    const lastSeen = Math.max(0, ...jobs.map((row) => storedUtcToMs(row.rider_location_at) || 0));
    const done = doneRows.find((row) => Number(row.rider_id) === id);
    return {
      id,
      name: rider.full_name,
      username: rider.username,
      activeJobs: jobs.length,
      onTheWay: jobs.filter((row) => row.status === 'Out for Delivery').length,
      online: Boolean(lastSeen && Date.now() - lastSeen < LOCATION_FRESH_MS),
      deliveredToday: done ? Number(done.count) : 0,
      feesToday: done ? Number(done.fees) : 0
    };
  });

  const items = await orderItems(orders.map((order) => Number(order.id)));
  return {
    view,
    kitchen: KITCHEN,
    stats: {
      needRider: allActive.filter((order) => !order.rider_id).length,
      withRider: allActive.filter((order) => order.rider_id && order.status !== 'Out for Delivery').length,
      onTheWay: allActive.filter((order) => order.status === 'Out for Delivery').length,
      placedToday: Number(todayTotals.placed) || 0,
      deliveredToday: Number(todayTotals.delivered) || 0,
      feesToday: Number(todayTotals.fees) || 0,
      cashOnTheRoad: allActive.filter((order) => order.payment_method === 'cash').reduce((sum, order) => sum + Number(order.total), 0)
    },
    riders,
    orders: orders.map((order) => {
      const locationAt = storedUtcToMs(order.rider_location_at);
      return {
        ...jobView(order, items, null),
        deliveryFee: Number(order.delivery_fee) || 0,
        riderName: order.rider_id ? names.get(Number(order.rider_id)) || 'Staff member' : null,
        riderLocation: order.status === 'Out for Delivery' && locationAt && Date.now() - locationAt < LOCATION_FRESH_MS
          ? point(order.rider_lat, order.rider_lng)
          : null,
        dispatchedAt: order.dispatched_at,
        deliveredAt: order.delivered_at
      };
    })
  };
}

// Admin gives an order to a rider, moves it to another rider, or frees it.
async function assignRider(orderId, riderId) {
  const order = await withTransaction(async (tx) => {
    const current = await tx.get('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!current || current.order_type !== 'delivery') throw fail(404, 'Delivery order not found.');
    if (!ACTIVE_STATUSES.includes(current.status)) throw fail(409, `This order is already ${String(current.status).toLowerCase()}.`);
    if (riderId === null) {
      if (current.status === 'Out for Delivery') throw fail(409, 'The rider already has the food. Move it to another rider instead.');
      await tx.run('UPDATE orders SET rider_id = NULL, delivery_code_failures = 0 WHERE id = ?', [orderId]);
    } else {
      const rider = await tx.get("SELECT id FROM users WHERE id = ? AND role = 'rider'", [riderId]);
      if (!rider) throw fail(400, 'Choose a delivery rider account.');
      await tx.run('UPDATE orders SET rider_id = ?, delivery_code_failures = 0 WHERE id = ?', [riderId, orderId]);
    }
    return tx.get('SELECT * FROM orders WHERE id = ?', [orderId]);
  });
  if (riderId) {
    reminders.sendToUser(Number(riderId), {
      title: `New delivery #${order.id} 🛵`,
      body: `The kitchen gave you a delivery to ${order.address}. Open the rider app.`,
      url: '/rider.html',
      tag: `rider-job-${order.id}`
    }).catch(() => {});
  }
  return order;
}

module.exports = {
  adminBoard,
  assignRider,
  checkDeliveryCode,
  DELIVERY_FEE_CENTS,
  KITCHEN,
  newDeliveryCode,
  parseCoordinate,
  notifyOrder,
  riderJobs,
  changeJob,
  updateRiderLocation,
  trackOrder,
  _internal: { distanceKm, etaMinutes, statusMessage, storedUtcToMs }
};
