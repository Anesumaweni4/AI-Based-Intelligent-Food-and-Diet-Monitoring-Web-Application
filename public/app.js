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
const deliveryUnavailableDialog = document.getElementById('delivery-unavailable-dialog');
const closeDeliveryUnavailableDialog = document.getElementById('close-delivery-unavailable');
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

let cart = [];
let menu = [];
let accountBalanceCents = 0;
let previousOrderStatuses = null;

function updateDeliveryFields() {
  if (deliveryOptionEl && deliveryOptionEl.value === 'delivery') {
    deliveryOptionEl.value = 'pickup';
    if (deliveryUnavailableDialog && !deliveryUnavailableDialog.open) {
      deliveryUnavailableDialog.showModal();
    } else {
      showToast('Delivery is temporarily unavailable. Please choose pickup.');
    }
  }

  if (addressFieldEl) {
    addressFieldEl.style.display = 'none';
  }

  if (addressInputEl) {
    addressInputEl.required = false;
    addressInputEl.value = '';
  }

  updateTotals();
}

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
    'Ready for Pickup': 'Your food is ready for pickup.',
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
        <span class="badge">${escapeHtml(order.status)}</span>
        <span class="student-order-date">${new Date(order.created_at).toLocaleString()}</span>
        <strong>${formatCurrency(order.total)}</strong>
      </summary>
      <div class="student-order-details">
        <p class="order-status-message">${escapeHtml(getOrderUpdateMessage(order.status))}</p>
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
  deliveryEl.textContent = formatCurrency(0);
  totalEl.textContent = formatCurrency(subtotal);
}

function renderCart() {
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
        <button type="button" data-action="increase" data-id="${item.id}" ${item.quantity >= Number(item.stock_quantity) ? 'disabled' : ''}>+</button>
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
  if (Number(existing ? existing.quantity : 0) >= Number(selected.stock_quantity)) {
    showToast(`Only ${Number(selected.stock_quantity)} ${selected.name} available in stock`);
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

  if (delta > 0 && item.quantity >= Number(item.stock_quantity)) {
    showToast(`Only ${Number(item.stock_quantity)} ${item.name} available in stock`);
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
                <button type="button" class="add-btn" data-action="choose-drink" ${drinkItems.every(drink => Number(drink.stock_quantity) === 0) ? 'disabled' : ''}>Choose</button>
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
            <span class="menu-stock ${Number(item.stock_quantity) === 0 ? 'out-of-stock' : ''}" ${isBeefBurger ? 'data-burger-stock' : ''}>
              ${Number(item.stock_quantity) === 0 ? 'Out of stock' : `${Number(item.stock_quantity)} available`}
            </span>
            <button type="button" class="add-btn" data-id="${Number(item.id)}" ${Number(item.stock_quantity) === 0 ? 'disabled' : ''}>Add</button>
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
      const stockLabel = card.querySelector('[data-burger-stock]');
      addButton.dataset.id = String(selected.id);
      addButton.disabled = Number(selected.stock_quantity) === 0;
      stockLabel.textContent = Number(selected.stock_quantity) === 0
        ? 'Out of stock'
        : `${Number(selected.stock_quantity)} available`;
      stockLabel.classList.toggle('out-of-stock', Number(selected.stock_quantity) === 0);
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

function openDrinkPicker() {
  const drinkItems = menu.filter(item => String(item.category).toLowerCase() === 'drink');
  drinkPickerOptions.innerHTML = drinkItems.map(item => `
    <div class="drink-picker-option">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.description || '')}</span>
        <span class="menu-stock ${Number(item.stock_quantity) === 0 ? 'out-of-stock' : ''}">
          ${Number(item.stock_quantity) === 0 ? 'Out of stock' : `${Number(item.stock_quantity)} available`}
        </span>
      </div>
      <strong class="drink-picker-price">${formatCurrency(item.price)}</strong>
      <button type="button" class="add-btn" data-id="${Number(item.id)}" ${Number(item.stock_quantity) === 0 ? 'disabled' : ''}>Add</button>
    </div>
  `).join('');
  drinkPickerOptions.querySelectorAll('.add-btn').forEach(button => {
    button.addEventListener('click', () => addToCart(Number(button.dataset.id)));
  });
  drinkPickerDialog.showModal();
}

async function placeOrder(paymentMethod) {
  const orderType = deliveryOptionEl ? deliveryOptionEl.value : 'pickup';
  const finalAddress = orderType === 'delivery' ? document.getElementById('address').value.trim() : 'Pickup';

  const payload = {
    phone: document.getElementById('phone').value.trim(),
    address: finalAddress,
    note: document.getElementById('note').value.trim(),
    orderType,
    paymentMethod,
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
    if (!response.ok) throw new Error(result.message || 'Order failed');

    const studentName = document.getElementById('customerName').value;
    accountBalanceCents = Number(result.balanceCents);
    walletBalanceEl.textContent = `Available: ${formatCredit(accountBalanceCents)}`;
    orderForm.reset();
    document.getElementById('customerName').value = studentName;
    cart = [];
    renderCart();
    showToast(paymentMethod === 'credit'
      ? `Order placed. Remaining credit: ${formatCredit(accountBalanceCents)}`
      : paymentMethod === 'monthly'
        ? 'Order placed on your monthly account. Your statement is due at month-end.'
        : 'Order placed. Please pay cash when collecting your food.');
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

if (closeDeliveryUnavailableDialog) {
  closeDeliveryUnavailableDialog.addEventListener('click', () => deliveryUnavailableDialog.close());
}

updateDeliveryFields();
bindCartEvents();
renderCart();
loadMenu();
loadWallet();
loadStudentOrders();
setInterval(loadStudentOrders, 5000);
