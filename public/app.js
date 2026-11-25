const menuGrid = document.getElementById('menu-grid');
const cartItems = document.getElementById('cart-items');
const subtotalEl = document.getElementById('subtotal');
const deliveryEl = document.getElementById('delivery');
const totalEl = document.getElementById('total');
const orderForm = document.getElementById('order-form');
const toast = document.getElementById('toast');
const deliveryOptionEl = document.getElementById('deliveryOption');
const addressFieldEl = document.getElementById('addressField');
const addressInputEl = document.getElementById('address');
const menuDateEl = document.getElementById('menu-date');
const shareLocationButton = document.getElementById('share-location');
const shareLocationStatus = document.getElementById('share-location-status');
let deliveryFeeCents = 350;
let deliveryLocation = null;
const walletBalanceEl = document.getElementById('wallet-balance');
const walletTransactionsEl = document.getElementById('wallet-transactions');
const monthlyAccountBalanceEl = document.getElementById('monthly-account-balance');
const monthlyAccountBalanceValueEl = document.getElementById('monthly-account-balance-value');
const paymentChoiceDialog = document.getElementById('payment-choice-dialog');
const paymentCreditBalanceEl = document.getElementById('payment-credit-balance');
const monthlyPaymentButton = paymentChoiceDialog.querySelector('[data-payment-method="monthly"]');
const studentOrdersEl = document.getElementById('student-orders');
const orderUpdateMessageEl = document.getElementById('order-update-message');
const enableOrderNotificationsButton = document.getElementById('enable-order-notifications');
const orderNotificationStatusEl = document.getElementById('order-notification-status');
const drinkPickerDialog = document.getElementById('drink-picker-dialog');
const drinkPickerOptions = document.getElementById('drink-picker-options');

const CART_STORAGE_KEY = 'kitchenCart';
let cart = [];
try {
  const saved = JSON.parse(sessionStorage.getItem(CART_STORAGE_KEY) || '[]');
  if (Array.isArray(saved)) {
    cart = saved.filter((item) => item && Number.isFinite(Number(item.id)) && Number(item.quantity) > 0);
  }
} catch {
  cart = [];
}

function saveCart() {
  try {
    sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch {
    // Private browsing: the cart still works on this page.
  }
}
let menu = [];
let accountBalanceCents = 0;
let previousOrderStatuses = null;

function isDeliverySelected() {
  return Boolean(deliveryOptionEl && deliveryOptionEl.value === 'delivery');
}

function updateDeliveryFields() {
  const delivery = isDeliverySelected();
  document.querySelectorAll('input[name="orderTypeChoice"]').forEach((radio) => {
    radio.checked = radio.value === (delivery ? 'delivery' : 'pickup');
  });
  if (addressFieldEl) addressFieldEl.hidden = !delivery;
  if (addressInputEl) addressInputEl.required = delivery;
  const formTitle = document.querySelector('.order-form-wrap h4');
  if (formTitle) formTitle.textContent = delivery ? 'Payment and delivery' : 'Payment and pickup';
  updateTotals();
}

function formatFee(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

fetch('/api/delivery/config')
  .then((response) => (response.ok ? response.json() : null))
  .then((config) => {
    if (!config) return;
    deliveryFeeCents = Math.round(Number(config.fee) * 100) || 0;
    document.querySelectorAll('[data-delivery-fee]').forEach((element) => {
      element.textContent = deliveryFeeCents ? formatFee(deliveryFeeCents) : 'free';
    });
    updateTotals();
  })
  .catch(() => {});

document.querySelectorAll('input[name="orderTypeChoice"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    if (!radio.checked || !deliveryOptionEl) return;
    deliveryOptionEl.value = radio.value;
    updateDeliveryFields();
    if (radio.value === 'delivery') addressInputEl?.focus();
  });
});

shareLocationButton?.addEventListener('click', () => {
  if (!('geolocation' in navigator)) {
    shareLocationStatus.textContent = 'Location is not available in this browser. Please use pickup, or open the site in Chrome or Safari.';
    return;
  }
  shareLocationButton.disabled = true;
  shareLocationStatus.textContent = 'Finding your location…';
  navigator.geolocation.getCurrentPosition((position) => {
    deliveryLocation = {
      lat: Math.round(position.coords.latitude * 1e6) / 1e6,
      lng: Math.round(position.coords.longitude * 1e6) / 1e6
    };
    shareLocationButton.disabled = false;
    shareLocationButton.classList.add('is-shared');
    shareLocationStatus.classList.remove('is-error');
    shareLocationButton.querySelector('span').textContent = 'Location shared ✓';
    shareLocationStatus.textContent = `Accurate to about ${Math.round(position.coords.accuracy)} m. Only your rider sees it.`;
  }, (error) => {
    shareLocationButton.disabled = false;
    shareLocationStatus.textContent = error.code === error.PERMISSION_DENIED
      ? 'Location permission was declined. Allow location for this site in your phone settings, then tap the button again.'
      : 'Could not find your location. Move near a window or turn on GPS, then tap the button again.';
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
});

function formatCurrency(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

function formatCredit(cents) {
  return formatCurrency(Number(cents) / 100);
}

async function loadWallet() {
  try {
    const response = await fetch('/api/account');
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) window.location.href = 'login.html';
      throw new Error(result.message || 'Unable to load student credit.');
    }
    accountBalanceCents = Number(result.user.balanceCents);
    document.getElementById('customerName').value = result.user.fullName;
    walletBalanceEl.textContent = `Available: ${formatCredit(result.user.balanceCents)}`;
    monthlyPaymentButton.hidden = !result.user.monthlyAccountEnabled;
    monthlyAccountBalanceEl.hidden = !result.user.monthlyAccountEnabled && !Number(result.user.monthlyBalanceCents);
    monthlyAccountBalanceValueEl.textContent = formatCredit(result.user.monthlyBalanceCents);
    const activityIsOpen = Boolean(walletTransactionsEl.querySelector('details[open]'));
    walletTransactionsEl.innerHTML = result.transactions.length
      ? `<details class="wallet-activity-dropdown" ${activityIsOpen ? 'open' : ''}>
          <summary>Recent activity</summary>
          <div class="wallet-activity-list">
            ${result.transactions.map((entry) => `
              <div class="wallet-transaction">
                <span>${escapeHtml(entry.type)}</span>
                <strong>${formatCredit(entry.amount_cents)}</strong>
              </div>
            `).join('')}
          </div>
        </details>`
      : '<p>No credit activity yet.</p>';
  } catch (error) {
    walletBalanceEl.textContent = error.message;
    walletBalanceEl.classList.add('error');
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => toast.classList.remove('show'), 2600);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function getOrderUpdateMessage(status) {
  const messages = {
    Pending: 'Your order has been received and is waiting for the kitchen.',
    Preparing: 'The kitchen is preparing your order.',
    'Ready for Pickup': 'Your food is ready. Pickup orders can be collected now; delivery orders are waiting for the rider.',
    'Out for Delivery': 'Your order is on its way.',
    Delivered: 'Your order has been delivered.',
    Collected: 'Your order has been collected. Thank you!',
    Cancelled: 'Your order was cancelled. Please contact the cashier if you need help.'
  };
  return messages[status] || `Your order status is ${status}.`;
}

function updateOrderNotificationControls() {
  if (!enableOrderNotificationsButton || !orderNotificationStatusEl) return;

  if (!('Notification' in window) || !window.isSecureContext) {
    enableOrderNotificationsButton.hidden = true;
    orderNotificationStatusEl.textContent = 'Browser notifications require a supported browser and a secure connection.';
    return;
  }

  enableOrderNotificationsButton.hidden = Notification.permission === 'granted';
  enableOrderNotificationsButton.disabled = Notification.permission === 'denied';
  orderNotificationStatusEl.textContent = Notification.permission === 'granted'
    ? 'Browser notifications are enabled.'
    : Notification.permission === 'denied'
      ? 'Notifications are blocked. Allow them in your browser site settings to enable alerts.'
      : 'Enable alerts for order status changes.';
}

function notifyOrderStatus(order, status) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const updates = {
    Pending: { title: 'Order received', body: 'Your order has been received and is waiting for the kitchen.' },
    Preparing: { title: 'Order accepted', body: 'The kitchen has accepted your order and is preparing it.' },
    'Ready for Pickup': { title: 'Order ready for pickup', body: 'Your food is ready. Please come to collect your order.' }
  };
  const update = updates[status];
  if (!update) return;

  try {
    const notification = new Notification(update.title, {
      body: `Order #${order.id}: ${update.body}`,
      tag: `order-${order.id}-${status}`
    });
    notification.addEventListener('click', () => {
      window.focus();
      window.location.hash = 'my-orders';
      notification.close();
    });
  } catch (error) {
    console.error('Unable to show order status notification:', error);
    if (orderNotificationStatusEl) {
      orderNotificationStatusEl.textContent = 'Unable to display a browser notification. Your order update is still shown on this page.';
    }
  }
}

if (enableOrderNotificationsButton) {
  enableOrderNotificationsButton.addEventListener('click', async () => {
    if (!('Notification' in window) || !window.isSecureContext) {
      updateOrderNotificationControls();
      return;
    }

    try {
      await Notification.requestPermission();
      updateOrderNotificationControls();
    } catch (error) {
      console.error('Unable to request browser notification permission:', error);
      orderNotificationStatusEl.textContent = 'Unable to enable browser notifications. Please check your browser settings.';
    }
  });
  updateOrderNotificationControls();
}

// ---------- My orders page: summary, filters, day groups, progress ----------
const ordersSummaryEl = document.getElementById('orders-summary');
const ordersFiltersEl = document.getElementById('orders-filters');
const ORDER_FILTERS = [['all', 'All'], ['active', 'In progress'], ['done', 'Completed'], ['cancelled', 'Cancelled']];
let studentOrdersFilter = 'all';

const ORDER_ICONS = {
  pickup: '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  delivery: '<svg viewBox="0 0 24 24"><circle cx="6" cy="17" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M8.5 17h7M15 7h2l3 5v5M3 12h9V7H5"/></svg>',
  flame: '<svg viewBox="0 0 24 24"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2.2-4.8.3 1.6 1.1 2.6 2.3 3 .1-3 .2-5.6.5-8.2z"/></svg>',
  receipt: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  wallet: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M16 14.5h2"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
};

function orderGroup(status) {
  if (status === 'Cancelled') return 'cancelled';
  if (['Delivered', 'Collected'].includes(status)) return 'done';
  return 'active';
}

function orderSteps(order) {
  if (order.order_type === 'delivery') {
    const steps = ['Placed', 'Preparing', 'Ready', 'On the way', 'Delivered'];
    const at = { Pending: 0, Preparing: 1, 'Ready for Pickup': 2, 'Out for Delivery': 3, Delivered: 4 }[order.status];
    return { steps, at: at ?? 0 };
  }
  const steps = ['Placed', 'Preparing', 'Ready', 'Collected'];
  const at = { Pending: 0, Preparing: 1, 'Ready for Pickup': 2, Collected: 3 }[order.status];
  return { steps, at: at ?? 0 };
}

function orderDayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function orderDayLabel(date) {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (orderDayKey(date) === orderDayKey(today)) return 'Today';
  if (orderDayKey(date) === orderDayKey(yesterday)) return 'Yesterday';
  return date.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' })
  });
}

function renderOrdersOverview(orders) {
  if (!ordersSummaryEl || !ordersFiltersEl) return;
  ordersSummaryEl.hidden = !orders.length;
  ordersFiltersEl.hidden = !orders.length;
  if (!orders.length) return;

  const counts = { all: orders.length, active: 0, done: 0, cancelled: 0 };
  const favourites = new Map();
  let spent = 0;
  orders.forEach(order => {
    const group = orderGroup(order.status);
    counts[group] += 1;
    if (group === 'cancelled') return;
    spent += Number(order.total) || 0;
    (order.items || []).forEach(item => {
      favourites.set(item.item_name, (favourites.get(item.item_name) || 0) + (Number(item.quantity) || 0));
    });
  });
  const [favouriteName, favouriteCount] = [...favourites.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
  const firstOrder = new Date(Math.min(...orders.map(order => new Date(order.created_at).getTime())));

  const tile = (tone, icon, label, value, note) => `
    <div class="op-stat" data-tone="${tone}">
      <span class="op-stat-icon" aria-hidden="true">${ORDER_ICONS[icon]}</span>
      <span class="op-stat-text">
        <span class="op-stat-label">${label}</span>
        <strong class="op-stat-value">${value}</strong>
        <span class="op-stat-note">${note}</span>
      </span>
    </div>`;
  ordersSummaryEl.innerHTML = [
    tile('active', 'flame', 'In progress', String(counts.active),
      counts.active ? 'Updating live' : 'Nothing cooking right now'),
    tile('orders', 'receipt', 'Orders placed', String(counts.all),
      `Since ${escapeHtml(firstOrder.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }))}`),
    tile('spent', 'wallet', 'Total spent', formatCurrency(spent), 'Cancelled orders not counted'),
    tile('favourite', 'heart', 'Your favourite', favouriteName ? escapeHtml(favouriteName) : '—',
      favouriteName ? `Ordered ${favouriteCount} time${favouriteCount === 1 ? '' : 's'}` : 'Order a meal to find out')
  ].join('');

  ordersFiltersEl.innerHTML = ORDER_FILTERS.map(([key, label]) => `
    <button type="button" class="op-filter" data-orders-filter="${key}" aria-pressed="${key === studentOrdersFilter}">
      ${label}<span class="op-filter-count">${counts[key]}</span>
    </button>`).join('');
}

function applyOrdersFilter() {
  let shown = 0;
  studentOrdersEl.querySelectorAll('.op-day').forEach(day => {
    let dayShown = 0;
    day.querySelectorAll('.student-order-card').forEach(card => {
      const show = studentOrdersFilter === 'all' || card.dataset.group === studentOrdersFilter;
      card.hidden = !show;
      if (show) dayShown += 1;
    });
    day.hidden = dayShown === 0;
    shown += dayShown;
  });
  const empty = studentOrdersEl.querySelector('.op-filter-empty');
  if (empty) {
    const label = (ORDER_FILTERS.find(([key]) => key === studentOrdersFilter) || ['', ''])[1].toLowerCase();
    empty.textContent = `No ${label} orders.`;
    empty.hidden = shown > 0;
  }
  ordersFiltersEl?.querySelectorAll('.op-filter').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.ordersFilter === studentOrdersFilter));
  });
}

ordersFiltersEl?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-orders-filter]');
  if (!button) return;
  studentOrdersFilter = button.dataset.ordersFilter;
  applyOrdersFilter();
});

function renderOrderCard(order, openOrderIds) {
  const isDelivery = order.order_type === 'delivery';
  const placed = new Date(order.created_at);
  const items = order.items || [];
  const itemCount = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const group = orderGroup(order.status);
  const finished = group === 'done';
  const names = items.map(item => item.item_name);
  const preview = names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2} more` : names.join(', ');
  const meta = [
    placed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    itemCount ? `${itemCount} item${itemCount === 1 ? '' : 's'}` : '',
    isDelivery ? 'Delivery' : 'Pickup'
  ].filter(Boolean).map(part => `<span>${escapeHtml(part)}</span>`).join(' · ');

  let progress = '';
  if (group === 'active') {
    const { steps, at } = orderSteps(order);
    progress = `
        <span class="so-progress" style="--steps:${steps.length};--at:${at}" aria-label="Step ${at + 1} of ${steps.length}: ${escapeHtml(steps[at])}">
          ${steps.map((label, index) => `
            <span class="so-step${index < at ? ' is-done' : ''}${index === at ? ' is-current' : ''}">
              <span class="so-dot" aria-hidden="true">${index < at ? ORDER_ICONS.check : ''}</span>
              <span class="so-step-label">${escapeHtml(label)}</span>
            </span>`).join('')}
        </span>`;
  }

  return `
    <details class="order-card student-order-card" data-order-id="${escapeHtml(order.id)}" data-group="${group}" ${openOrderIds.has(String(order.id)) ? 'open' : ''}>
      <summary class="student-order-summary">
        <span class="so-icon" data-type="${isDelivery ? 'delivery' : 'pickup'}" aria-hidden="true">
          ${isDelivery ? ORDER_ICONS.delivery : ORDER_ICONS.pickup}
        </span>
        <span class="so-main">
          <strong class="so-title">Order #${escapeHtml(order.id)}</strong>
          ${preview ? `<span class="so-items">${escapeHtml(preview)}</span>` : ''}
          <span class="so-meta">${meta}</span>
        </span>
        <span class="badge" data-tone="${orderStatusTone(order.status)}">${escapeHtml(order.status)}</span>
        <strong class="so-total">${formatCurrency(order.total)}</strong>${progress}
      </summary>
      <div class="student-order-details">
        <p class="order-status-message">${escapeHtml(getOrderUpdateMessage(order.status))}</p>
        ${isDelivery ? `
          <div class="order-delivery-row">
            <span class="order-delivery-to">🛵 Delivery to <strong>${escapeHtml(order.address)}</strong></span>
            ${order.delivery_code && !['Delivered', 'Cancelled'].includes(order.status)
              ? `<span class="order-delivery-code">Code <strong>${escapeHtml(order.delivery_code)}</strong></span>` : ''}
          </div>` : ''}
        ${group === 'active'
          ? `<button type="button" class="track-btn" data-track="${escapeHtml(order.id)}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>
              ${isDelivery && order.status === 'Out for Delivery' ? 'Track the rider live' : 'Track this order'}
            </button>` : ''}
        <ul class="student-order-items">
          ${items.map(item => `
            <li>
              <span>${Number(item.quantity)} × ${escapeHtml(item.item_name)}</span>
              <strong>${formatCurrency(Number(item.unit_price) * Number(item.quantity))}</strong>
            </li>
          `).join('')}
          <li class="so-items-total"><span>Total</span><strong>${formatCurrency(order.total)}</strong></li>
        </ul>
        <div class="so-actions">
          <button type="button" class="so-feedback" data-order-feedback="${escapeHtml(order.id)}" data-feedback-topic="${finished ? 'food' : 'order'}">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/></svg>
            ${finished ? 'Rate this order' : 'Report a problem'}
          </button>
        </div>
      </div>
    </details>`;
}

function renderStudentOrders(orders) {
  renderOrdersOverview(orders);
  if (!orders.length) {
    studentOrdersEl.innerHTML = `
      <div class="op-empty">
        <span class="op-empty-icon" aria-hidden="true">${ORDER_ICONS.receipt}</span>
        <strong>No orders yet</strong>
        <p>When you order a meal, you can follow it here from the kitchen to your hands.</p>
        <a class="btn-primary op-empty-cta" href="#menu">Browse the menu</a>
      </div>`;
    return;
  }

  const openOrderIds = new Set(
    Array.from(studentOrdersEl.querySelectorAll('details[open]'), element => element.dataset.orderId)
  );
  const days = [];
  const byDay = new Map();
  [...orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).forEach(order => {
    const placed = new Date(order.created_at);
    const key = orderDayKey(placed);
    if (!byDay.has(key)) {
      const day = { label: orderDayLabel(placed), orders: [] };
      byDay.set(key, day);
      days.push(day);
    }
    byDay.get(key).orders.push(order);
  });

  studentOrdersEl.innerHTML = days.map(day => {
    const total = day.orders.filter(order => order.status !== 'Cancelled')
      .reduce((sum, order) => sum + (Number(order.total) || 0), 0);
    return `
    <section class="op-day">
      <header class="op-day-head">
        <h4>${escapeHtml(day.label)}</h4>
        <span>${day.orders.length} order${day.orders.length === 1 ? '' : 's'} · ${formatCurrency(total)}</span>
      </header>
      <div class="op-day-list">${day.orders.map(order => renderOrderCard(order, openOrderIds)).join('')}</div>
    </section>`;
  }).join('') + '<p class="op-filter-empty" hidden></p>';
  applyOrdersFilter();
}

function orderStatusTone(status) {
  if (['Delivered', 'Collected'].includes(status)) return 'done';
  if (status === 'Cancelled') return 'cancelled';
  if (['Ready', 'Ready for Pickup', 'Out for Delivery'].includes(status)) return 'ready';
  if (['Preparing', 'Accepted', 'Cooking'].includes(status)) return 'preparing';
  return 'pending';
}

// "Rate this order" / "Report a problem" opens the feedback chat about that order.
studentOrdersEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-order-feedback]');
  if (!button || typeof window.openFeedback !== 'function') return;
  window.openFeedback({ category: button.dataset.feedbackTopic, orderId: button.dataset.orderFeedback, opener: button });
});

async function loadStudentOrders() {
  try {
    const response = await fetch('/api/account/orders');
    const orders = await response.json();
    if (!response.ok) {
      if (response.status === 401) window.location.href = 'login.html';
      throw new Error(orders.message || 'Unable to load your order updates.');
    }
    if (orderUpdateMessageEl.classList.contains('error')) {
      orderUpdateMessageEl.textContent = '';
      orderUpdateMessageEl.classList.remove('error');
    }

    const changedOrders = previousOrderStatuses
      ? orders.filter(order =>
          previousOrderStatuses.has(Number(order.id)) &&
          previousOrderStatuses.get(Number(order.id)) !== order.status)
      : [];
    previousOrderStatuses = new Map(orders.map(order => [Number(order.id), order.status]));
    renderStudentOrders(orders);

    if (changedOrders.length) {
      const message = changedOrders.map(order =>
        `Order #${order.id}: ${getOrderUpdateMessage(order.status)}`
      ).join(' ');
      orderUpdateMessageEl.textContent = message;
      showToast(message);
      changedOrders.forEach((order) => notifyOrderStatus(order, order.status));
    }
  } catch (error) {
    console.error('Error loading student order updates:', error);
    orderUpdateMessageEl.textContent = error.message;
    orderUpdateMessageEl.classList.add('error');
  }
}

function getCartItem(menuId) {
  return cart.find(item => item.id === menuId);
}

function updateTotals() {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  subtotalEl.textContent = formatCurrency(subtotal);
  const fee = isDeliverySelected() ? deliveryFeeCents / 100 : 0;
  deliveryEl.textContent = isDeliverySelected() ? formatCurrency(fee) : 'Free pickup';
  totalEl.textContent = formatCurrency(subtotal + fee);
}

function renderCart() {
  saveCart();
  if (!cart.length) {
    cartItems.innerHTML = '<div class="empty-state">Your cart is empty. Add a few items to begin.</div>';
    updateTotals();
    return;
  }

  cartItems.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div>
        <strong>${item.name}</strong>
      </div>
      <div class="qty-controls">
        <button type="button" data-action="decrease" data-id="${item.id}">-</button>
        <span>${item.quantity}</span>
        <button type="button" data-action="increase" data-id="${item.id}">+</button>
      </div>
      <div>${formatCurrency(item.price * item.quantity)}</div>
      <button type="button" class="remove-btn" data-action="remove" data-id="${item.id}">Remove</button>
    </div>
  `).join('');

  updateTotals();
}

function addToCart(menuId) {
  const selected = menu.find(item => item.id === menuId);
  if (!selected) return;

  const existing = getCartItem(menuId);
  const available = Number(selected.stock_quantity);
  if (available <= 0) {
    showToast(`Sorry, ${selected.name} is sold out. Please choose another meal.`);
    return;
  }
  if ((existing?.quantity || 0) >= available) {
    showToast(available === 1
      ? `Only 1 plate of ${selected.name} is available.`
      : `Only ${available} plates of ${selected.name} are available.`);
    return;
  }
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ ...selected, quantity: 1 });
  }

  renderCart();
  showToast(`${selected.name} added to cart`);
}

function changeQuantity(menuId, delta) {
  const item = getCartItem(menuId);
  if (!item) return;

  const selected = menu.find(entry => entry.id === menuId);
  if (delta > 0 && selected && item.quantity >= Number(selected.stock_quantity)) {
    const available = Number(selected.stock_quantity);
    showToast(available === 1
      ? `Only 1 plate of ${item.name} is available.`
      : `Only ${available} plates of ${item.name} are available.`);
    return;
  }

  item.quantity += delta;
  if (item.quantity <= 0) {
    cart = cart.filter(entry => entry.id !== menuId);
  }
  renderCart();
}

function bindCartEvents() {
  cartItems.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;

    const { action, id } = button.dataset;
    const itemId = Number(id);

    if (action === 'increase') changeQuantity(itemId, 1);
    if (action === 'decrease') changeQuantity(itemId, -1);
    if (action === 'remove') {
      cart = cart.filter(item => item.id !== itemId);
      renderCart();
    }
  });
}

async function loadMenu() {
  const response = await fetch('/api/menu');
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'Failed to load menu');
  menu = result.items.map(item => ({
    ...item,
    id: Number(item.id),
    stock_quantity: Number(item.stock_quantity)
  }));
  menuDateEl.textContent = `${result.dayName}, ${result.date} — today's meals`;

  if (menu.length === 0) {
    menuGrid.innerHTML = '<div class="empty-state">No meals are scheduled for today. Please check back later.</div>';
    return;
  }

  const drinkItems = menu.filter(item => String(item.category).toLowerCase() === 'drink');
  const burgerAndChips = menu.find(item => item.name === 'Beef Burger & Chips');
  const menuCards = [];
  let drinkCardAdded = false;
  for (const item of menu) {
    if (String(item.category).toLowerCase() === 'drink') {
      if (!drinkCardAdded) {
        menuCards.push(`
          <article class="menu-card">
            <img src="drinks-assortment.jpg" alt="Bottled Minute Maid drinks" />
            <div class="menu-card-content">
              <span class="menu-category">Drink</span>
              <h4>Choose a drink</h4>
              <p>Juices, soft drinks, and smoothies.</p>
              <div class="meta-row">
                <span class="price">From ${formatCurrency(Math.min(...drinkItems.map(drink => Number(drink.price))))}</span>
                <button type="button" class="add-btn" data-action="choose-drink">Choose</button>
              </div>
            </div>
          </article>
        `);
        drinkCardAdded = true;
      }
      continue;
    }
    if (item.name === 'Beef Burger & Chips') continue;

    const isBeefBurger = item.name === 'Beef Burger' && burgerAndChips;

    menuCards.push(`
      <article class="menu-card">
        <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" />
        <div class="menu-card-content">
          <span class="menu-category">${escapeHtml(item.category)}</span>
          <h4>${escapeHtml(item.name)}</h4>
          <p>${escapeHtml(item.description || '')}</p>
          ${isBeefBurger ? `
            <label class="burger-option-label">
              Burger option
              <select class="burger-option" aria-label="Choose a burger option">
                <option value="${Number(item.id)}">Burger alone — ${formatCurrency(item.price)}</option>
                <option value="${Number(burgerAndChips.id)}">Burger &amp; chips — ${formatCurrency(burgerAndChips.price)}</option>
              </select>
            </label>
          ` : ''}
          <div class="meta-row">
            <span class="price" ${isBeefBurger ? 'data-burger-price' : ''}>${formatCurrency(item.price)}</span>
            <span class="menu-stock-status"${isBeefBurger ? ' data-burger-stock' : ''}>${Number(item.stock_quantity) > 0 ? `${Number(item.stock_quantity)} plates available` : 'Sold out'}</span>
            <button type="button" class="add-btn" data-id="${Number(item.id)}">${Number(item.stock_quantity) > 0 ? 'Add' : 'Sold out'}</button>
          </div>
        </div>
      </article>
    `);
  }
  menuGrid.innerHTML = menuCards.join('');

  menuGrid.querySelectorAll('.burger-option').forEach(select => {
    select.addEventListener('change', () => {
      const selected = menu.find(item => item.id === Number(select.value));
      if (!selected) return;

      const card = select.closest('.menu-card');
      card.querySelector('[data-burger-price]').textContent = formatCurrency(selected.price);
      const addButton = card.querySelector('.add-btn');
      addButton.dataset.id = String(selected.id);
      const available = Number(selected.stock_quantity);
      addButton.textContent = available > 0 ? 'Add' : 'Sold out';
      card.querySelector('[data-burger-stock]').textContent = available > 0
        ? `${available} plates available`
        : 'Sold out';
    });
  });

  menuGrid.querySelectorAll('.add-btn').forEach(button => {
    if (button.dataset.action === 'choose-drink') {
      button.addEventListener('click', openDrinkPicker);
    } else {
      button.addEventListener('click', () => addToCart(Number(button.dataset.id)));
    }
  });
}

let drinkFilter = 'all';

function drinkKind(item) {
  const name = String(item.name || '').toLowerCase();
  if (/water|smoothie/.test(name)) return 'water';
  if (/juice|minute maid|maid|cherry|berry|mango|pineapple|apple|cranberry/.test(name)) return 'juice';
  return 'soda';
}

function renderDrinkPicker() {
  const drinkItems = menu.filter(item => String(item.category).toLowerCase() === 'drink');
  const shown = drinkItems
    .filter(item => drinkFilter === 'all' || drinkKind(item) === drinkFilter)
    .sort((a, b) => (Number(b.stock_quantity) > 0) - (Number(a.stock_quantity) > 0));

  drinkPickerOptions.innerHTML = shown.length ? shown.map(item => {
    const id = Number(item.id);
    const inCart = getCartItem(id)?.quantity || 0;
    const soldOut = Number(item.stock_quantity) <= 0;
    const action = soldOut
      ? '<span class="dpk-soldout">Sold out</span>'
      : inCart
        ? `<div class="dpk-stepper">
             <button type="button" data-step="-1" data-id="${id}" aria-label="Remove one ${escapeHtml(item.name)}">&minus;</button>
             <span aria-label="${inCart} in cart">${inCart}</span>
             <button type="button" data-step="1" data-id="${id}" aria-label="Add one more ${escapeHtml(item.name)}">+</button>
           </div>`
        : `<button type="button" class="dpk-add" data-step="1" data-id="${id}" aria-label="Add ${escapeHtml(item.name)}">
             <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Add</span>
           </button>`;
    return `
      <article class="dpk-item${soldOut ? ' is-soldout' : ''}${inCart ? ' is-picked' : ''}">
        <img src="${escapeHtml(item.image || '/drinks-assortment.jpg')}" alt="" loading="lazy" />
        <div class="dpk-info">
          <h3>${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(item.description || '')}</p>
          <strong class="dpk-price">${formatCurrency(item.price)}</strong>
        </div>
        <div class="dpk-action">${action}</div>
      </article>`;
  }).join('') : '<p class="dpk-empty">No drinks in this group right now.</p>';

  const picked = cart.filter(entry => String(entry.category).toLowerCase() === 'drink');
  const count = picked.reduce((sum, entry) => sum + entry.quantity, 0);
  const total = picked.reduce((sum, entry) => sum + entry.price * entry.quantity, 0);
  document.getElementById('drink-picker-summary').innerHTML = count
    ? `<strong>${count} drink${count === 1 ? '' : 's'}</strong> in your cart &middot; ${formatCurrency(total)}`
    : 'No drinks added yet';
}

function openDrinkPicker() {
  renderDrinkPicker();
  drinkPickerDialog.showModal();
}

drinkPickerOptions.addEventListener('click', (event) => {
  const button = event.target.closest('[data-step]');
  if (!button) return;
  const id = Number(button.dataset.id);
  const step = Number(button.dataset.step);
  if (step > 0 && !getCartItem(id)) addToCart(id);
  else changeQuantity(id, step);
  renderDrinkPicker();
  const again = drinkPickerOptions.querySelector(`[data-id="${id}"][data-step="${step}"]`)
    || drinkPickerOptions.querySelector(`[data-id="${id}"]`);
  again?.focus({ preventScroll: true });
});

document.getElementById('drink-picker-filters').addEventListener('click', (event) => {
  const chip = event.target.closest('[data-filter]');
  if (!chip) return;
  drinkFilter = chip.dataset.filter;
  document.querySelectorAll('#drink-picker-filters .dpk-chip').forEach(other => {
    other.classList.toggle('is-active', other === chip);
    other.setAttribute('aria-pressed', String(other === chip));
  });
  renderDrinkPicker();
});

document.getElementById('drink-picker-x').addEventListener('click', () => drinkPickerDialog.close());
drinkPickerDialog.addEventListener('click', (event) => {
  if (event.target === drinkPickerDialog) drinkPickerDialog.close();
});

async function placeOrder(paymentMethod) {
  const orderType = deliveryOptionEl ? deliveryOptionEl.value : 'pickup';
  const finalAddress = orderType === 'delivery' ? document.getElementById('address').value.trim() : 'Pickup';

  const payload = {
    phone: document.getElementById('phone').value.trim(),
    address: finalAddress,
    note: document.getElementById('note').value.trim(),
    orderType,
    paymentMethod,
    deliveryLat: orderType === 'delivery' && deliveryLocation ? deliveryLocation.lat : null,
    deliveryLng: orderType === 'delivery' && deliveryLocation ? deliveryLocation.lng : null,
    items: cart.map(item => ({ id: item.id, quantity: item.quantity }))
  };

  const submitButton = orderForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) {
      const message = result.message || 'Order failed';
      if (response.status === 409) {
        showToast(message);
        loadMenu().catch(error => console.error('Unable to refresh meal availability:', error));
        return;
      }
      throw new Error(message);
    }

    const studentName = document.getElementById('customerName').value;
    accountBalanceCents = Number(result.balanceCents);
    walletBalanceEl.textContent = `Available: ${formatCredit(accountBalanceCents)}`;
    const placedPhone = document.getElementById('phone').value;
    orderForm.reset();
    document.getElementById('customerName').value = studentName;
    document.getElementById('phone').value = placedPhone;
    deliveryLocation = null;
    if (shareLocationButton) {
      shareLocationButton.classList.remove('is-shared');
      shareLocationButton.querySelector('span').textContent = 'Share my live location';
    }
    if (deliveryOptionEl) deliveryOptionEl.value = 'pickup';
    updateDeliveryFields();
    if (typeof window.closeCart === 'function') window.closeCart();
    cart = [];
    renderCart();
    showToast(paymentMethod === 'credit'
      ? `Order placed. Remaining credit: ${formatCredit(accountBalanceCents)}`
      : paymentMethod === 'monthly'
        ? 'Order placed on your monthly account. Your statement is due at month-end.'
        : orderType === 'delivery'
          ? 'Order placed. Please pay the rider in cash when your food arrives.'
          : 'Order placed. Please pay cash when collecting your food.');
    if (orderType === 'delivery' && result.order && result.order.delivery_code) {
      showToast(`Order #${result.order.id} placed. Your delivery code is ${result.order.delivery_code}.`);
    }
    if (result.order) notifyOrderStatus(result.order, 'Pending');
    await loadMenu();
    await loadWallet();
    await loadStudentOrders();
  } catch (error) {
    showToast(error.message);
  } finally {
    submitButton.disabled = false;
    if (paymentChoiceDialog.open) paymentChoiceDialog.close();
  }
}

orderForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!cart.length) {
    showToast('Add at least one item before ordering');
    return;
  }
  if (!orderForm.reportValidity()) return;
  if (isDeliverySelected() && !deliveryLocation) {
    shareLocationStatus.textContent = 'Please share your live location so the rider can find you.';
    shareLocationStatus.classList.add('is-error');
    shareLocationButton?.focus();
    showToast('Share your live location to order delivery.');
    return;
  }
  paymentCreditBalanceEl.textContent = formatCredit(accountBalanceCents);
  paymentChoiceDialog.showModal();
});

paymentChoiceDialog.querySelectorAll('[data-payment-method]').forEach((button) => {
  button.addEventListener('click', () => placeOrder(button.dataset.paymentMethod));
});

document.getElementById('cancel-payment-choice').addEventListener('click', () => {
  paymentChoiceDialog.close();
});

document.getElementById('close-drink-picker').addEventListener('click', () => {
  drinkPickerDialog.close();
});

if (deliveryOptionEl) {
  deliveryOptionEl.addEventListener('change', updateDeliveryFields);
}


updateDeliveryFields();
bindCartEvents();
renderCart();
loadMenu();
loadWallet();
loadStudentOrders();
setInterval(loadStudentOrders, 5000);
