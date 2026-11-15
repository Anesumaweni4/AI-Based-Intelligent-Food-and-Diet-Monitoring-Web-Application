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

function renderStudentOrders(orders) {
  if (!orders.length) {
    studentOrdersEl.innerHTML = '<div class="empty-state">You have no orders yet. Your order updates will appear here.</div>';
    return;
  }

  const openOrderIds = new Set(
    Array.from(studentOrdersEl.querySelectorAll('details[open]'), element => element.dataset.orderId)
  );
  studentOrdersEl.innerHTML = orders.map(order => `
    <details class="order-card student-order-card" data-order-id="${escapeHtml(order.id)}" ${openOrderIds.has(String(order.id)) ? 'open' : ''}>
      <summary class="student-order-summary">
        <strong>Order #${escapeHtml(order.id)}</strong>
        <span class="badge">${order.order_type === 'delivery' ? '🛵 ' : ''}${escapeHtml(order.status)}</span>
        <span class="student-order-date">${new Date(order.created_at).toLocaleString()}</span>
        <strong>${formatCurrency(order.total)}</strong>
      </summary>
      <div class="student-order-details">
        <p class="order-status-message">${escapeHtml(getOrderUpdateMessage(order.status))}</p>
        ${order.order_type === 'delivery' ? `
          <div class="order-delivery-row">
            <span class="order-delivery-to">🛵 Delivery to <strong>${escapeHtml(order.address)}</strong></span>
            ${order.delivery_code && !['Delivered', 'Cancelled'].includes(order.status)
              ? `<span class="order-delivery-code">Code <strong>${escapeHtml(order.delivery_code)}</strong></span>` : ''}
          </div>` : ''}
        ${!['Delivered', 'Collected', 'Cancelled'].includes(order.status)
          ? `<button type="button" class="track-btn" data-track="${escapeHtml(order.id)}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>
              ${order.order_type === 'delivery' && order.status === 'Out for Delivery' ? 'Track the rider live' : 'Track this order'}
            </button>` : ''}
        <ul class="student-order-items">
          ${(order.items || []).map(item => `
            <li>
              <span>${Number(item.quantity)} × ${escapeHtml(item.item_name)}</span>
              <strong>${formatCurrency(Number(item.unit_price) * Number(item.quantity))}</strong>
            </li>
          `).join('')}
        </ul>
      </div>
    </details>
  `).join('');
}

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
