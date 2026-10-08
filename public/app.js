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
const paymentChoiceDialog = document.getElementById('payment-choice-dialog');
const paymentCreditBalanceEl = document.getElementById('payment-credit-balance');
const studentOrdersEl = document.getElementById('student-orders');
const orderUpdateMessageEl = document.getElementById('order-update-message');
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
    walletTransactionsEl.innerHTML = result.transactions.length
      ? `<h4>Recent activity</h4>${result.transactions.map((entry) => `
          <div class="wallet-transaction">
            <span>${String(entry.type).replace(/[&<>"']/g, '')}</span>
            <strong>${formatCredit(entry.amount_cents)}</strong>
          </div>
        `).join('')}`
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

function renderStudentOrders(orders) {
  if (!orders.length) {
    studentOrdersEl.innerHTML = '<div class="empty-state">You have no orders yet. Your order updates will appear here.</div>';
    return;
  }

  studentOrdersEl.innerHTML = orders.map(order => `
    <article class="order-card">
      <div class="order-header">
        <h4>Order #${escapeHtml(order.id)}</h4>
        <span class="badge">${escapeHtml(order.status)}</span>
      </div>
      <div class="order-meta">
        <span>${new Date(order.created_at).toLocaleString()}</span>
        <strong>${formatCurrency(order.total)}</strong>
      </div>
      <p class="order-status-message">${escapeHtml(getOrderUpdateMessage(order.status))}</p>
    </article>
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
  menu = result.items;
  menuDateEl.textContent = `${result.dayName}, ${result.date} — today's meals`;

  if (menu.length === 0) {
    menuGrid.innerHTML = '<div class="empty-state">No meals are scheduled for today. Please check back later.</div>';
    return;
  }

  const drinkItems = menu.filter(item => String(item.category).toLowerCase() === 'drink');
  const menuCards = [];
  let drinkCardAdded = false;
  for (const item of menu) {
    if (String(item.category).toLowerCase() === 'drink') {
      if (!drinkCardAdded) {
        menuCards.push(`
          <article class="menu-card">
            <img src="drinks-assortment.svg" alt="An assortment of juice and soft drinks" />
            <div class="menu-card-content">
              <span class="menu-category">Drink</span>
              <h4>Choose a drink</h4>
              <p>Minute Maid, Pepsi, Coke, and Fruit Smoothie.</p>
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

    menuCards.push(`
      <article class="menu-card">
        <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" />
        <div class="menu-card-content">
          <span class="menu-category">${escapeHtml(item.category)}</span>
          <h4>${escapeHtml(item.name)}</h4>
          <p>${escapeHtml(item.description || '')}</p>
          <div class="meta-row">
            <span class="price">${formatCurrency(item.price)}</span>
            <button type="button" class="add-btn" data-id="${Number(item.id)}">Add</button>
          </div>
        </div>
      </article>
    `);
  }
  menuGrid.innerHTML = menuCards.join('');

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
      </div>
      <strong class="drink-picker-price">${formatCurrency(item.price)}</strong>
      <button type="button" class="add-btn" data-id="${Number(item.id)}">Add</button>
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
      : 'Order placed. Please pay cash when collecting your food.');
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
