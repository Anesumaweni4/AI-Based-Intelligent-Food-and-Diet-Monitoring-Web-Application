// Restaurant orders board: status tabs, search, live refresh and order actions.
const ordersContainer = document.getElementById('restaurant-orders');
const orderSearchInput = document.getElementById('restaurant-order-search');
const orderDateInput = document.getElementById('restaurant-order-date');
const clearOrderFiltersButton = document.getElementById('restaurant-order-filter-clear');
const orderResultsMessage = document.getElementById('restaurant-order-results');
const ordersTabs = document.getElementById('orders-tabs');
const ordersUpdated = document.getElementById('orders-updated');
const ordersLive = document.getElementById('orders-live');

const ACTIVE_STATUSES = ['Pending', 'Preparing', 'Ready for Pickup', 'Out for Delivery'];
const DONE_STATUSES = ['Collected', 'Delivered'];
const STATUS_TONES = {
  Pending: 'pending',
  Preparing: 'preparing',
  'Ready for Pickup': 'ready',
  'Out for Delivery': 'ready',
  Collected: 'done',
  Delivered: 'done',
  Cancelled: 'cancelled'
};
const STATUS_LABELS = { Pending: 'Waiting' };

let restaurantOrders = [];
let ordersSignature = '';
let statusFilter = 'all';
let confirmingOrderId = null;
const cardMessages = new Map();
const busyOrders = new Set();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function parseOrderDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getOrderLocalDate(value) {
  const date = parseOrderDate(value);
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayKey() {
  return getOrderLocalDate(new Date());
}

function timeAgo(value) {
  const date = parseOrderDate(value);
  if (!date) return '';
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function formatOrderTime(value) {
  const date = parseOrderDate(value);
  if (!date) return '';
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (getOrderLocalDate(value) === todayKey()) return `Today, ${time}`;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, ${time}`;
}

function matchesStatusFilter(order, filter) {
  if (filter === 'all') return true;
  if (filter === 'active') return ACTIVE_STATUSES.includes(order.status);
  if (filter === 'done') return DONE_STATUSES.includes(order.status);
  return order.status === filter;
}

function getSearchFilteredOrders() {
  const search = orderSearchInput.value.trim().toLocaleLowerCase().replace(/^#/, '');
  const selectedDate = orderDateInput.value;
  return restaurantOrders.filter((order) => {
    const matchesSearch = !search ||
      `${order.customer_name} ${order.phone}`.toLocaleLowerCase().includes(search) ||
      String(order.id) === search;
    const matchesDate = !selectedDate || getOrderLocalDate(order.created_at) === selectedDate;
    return matchesSearch && matchesDate;
  });
}

function renderStats() {
  const count = (statuses) => restaurantOrders.filter((order) => statuses.includes(order.status)).length;
  const today = todayKey();
  const doneToday = restaurantOrders.filter((order) =>
    DONE_STATUSES.includes(order.status) && getOrderLocalDate(order.collected_at || order.created_at) === today);
  const salesToday = doneToday.reduce((sum, order) => sum + Number(order.total || 0), 0);

  document.querySelector('[data-stat="pending"]').textContent = count(['Pending']);
  document.querySelector('[data-stat="preparing"]').textContent = count(['Preparing']);
  document.querySelector('[data-stat="ready"]').textContent = count(['Ready for Pickup', 'Out for Delivery']);
  document.querySelector('[data-stat="done"]').textContent = doneToday.length;
  document.getElementById('orders-today-sales').textContent = doneToday.length
    ? `${formatCurrency(salesToday)} in sales`
    : 'Collected or delivered';
}

function renderTabs(searchFiltered) {
  ordersTabs.querySelectorAll('[data-orders-tab]').forEach((tab) => {
    const key = tab.dataset.ordersTab;
    const counter = tab.querySelector('[data-count]');
    if (counter) counter.textContent = searchFiltered.filter((order) => matchesStatusFilter(order, key)).length;
    tab.setAttribute('aria-selected', String(key === statusFilter));
    tab.tabIndex = key === statusFilter ? 0 : -1;
  });
}

function getActions(order) {
  const id = Number(order.id);
  if (!ACTIVE_STATUSES.includes(order.status)) return '';
  const busy = busyOrders.has(id) ? ' disabled' : '';

  if (confirmingOrderId === id) {
    const refundText = order.payment_method === 'credit'
      ? `${formatCurrency(order.total)} goes back to the student’s credit.`
      : 'The customer has not paid by credit, so nothing is refunded.';
    return `
      <div class="order-confirm" role="group" aria-label="Confirm cancelling order ${id}">
        <p><strong>Cancel order #${id}?</strong> ${refundText}</p>
        <div class="order-confirm-actions">
          <button type="button" class="order-btn order-btn--danger" data-order-id="${id}" data-status="Cancelled"${busy}>Yes, cancel order</button>
          <button type="button" class="order-btn order-btn--ghost" data-cancel-confirm="${id}"${busy}>Keep order</button>
        </div>
      </div>`;
  }

  const buttons = [];
  if (order.status === 'Pending') {
    buttons.push(`<button type="button" class="order-btn order-btn--primary" data-order-id="${id}" data-status="Preparing"${busy}>
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c2 3 5 4.5 5 9a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5.5C10 8 11 9 12 9c0-2 0-4 0-6z"/></svg>
      Start preparing</button>`);
  }
  if (['Pending', 'Preparing'].includes(order.status)) {
    buttons.push(`<button type="button" class="order-btn ${order.status === 'Preparing' ? 'order-btn--primary' : 'order-btn--soft'}" data-order-id="${id}" data-status="Ready for Pickup"${busy}>
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18"/><path d="M5 18a7 7 0 0 1 14 0"/><path d="M12 8V6"/></svg>
      Ready for pickup</button>`);
  }
  if (order.status === 'Ready for Pickup') {
    buttons.push(`<button type="button" class="order-btn order-btn--success" data-order-id="${id}" data-status="Collected"${busy}>
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>
      Mark collected</button>`);
  }
  buttons.push(`<button type="button" class="order-btn order-btn--ghost-danger" data-confirm-cancel="${id}"${busy}>Cancel</button>`);
  return `<div class="order-actions-row">${buttons.join('')}</div>`;
}

function renderOrderCard(order) {
  const id = Number(order.id);
  const tone = STATUS_TONES[order.status] || 'pending';
  const isPickup = String(order.address || '').trim().toLowerCase() === 'pickup';
  const items = Array.isArray(order.items) ? order.items : [];
  const itemCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const message = cardMessages.get(id);
  const phone = String(order.phone || '').trim();

  return `
    <article class="kitchen-order" data-tone="${tone}" data-card-id="${id}">
      <header class="kitchen-order-head">
        <div>
          <p class="kitchen-order-number">Order <strong>#${id}</strong></p>
          <p class="kitchen-order-time" title="${escapeHtml(formatOrderTime(order.created_at))}">${escapeHtml(formatOrderTime(order.created_at))} · ${escapeHtml(timeAgo(order.created_at))}</p>
        </div>
        <span class="kitchen-status" data-tone="${tone}">${escapeHtml(STATUS_LABELS[order.status] || order.status)}</span>
      </header>

      <div class="kitchen-customer">
        <span class="kitchen-avatar" aria-hidden="true">${escapeHtml(String(order.customer_name || '?').trim().charAt(0).toUpperCase() || '?')}</span>
        <div>
          <strong>${escapeHtml(order.customer_name)}</strong>
          ${phone ? `<a href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ''))}">${escapeHtml(phone)}</a>` : ''}
        </div>
      </div>

      <div class="kitchen-chips">
        <span class="kitchen-chip">
          ${isPickup
            ? '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>Pickup'
            : `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>Delivery · ${escapeHtml(order.address)}`}
        </span>
        <span class="kitchen-chip">
          ${order.payment_method === 'credit'
            ? '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h13v4"/><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M16 13.5h2"/></svg>Student credit'
            : '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>Cash'}
        </span>
      </div>

      <ul class="kitchen-items" aria-label="Items in order ${id}">
        ${items.map((item) => `
          <li>
            <span class="kitchen-qty">${Number(item.quantity)}×</span>
            <span class="kitchen-item-name">${escapeHtml(item.item_name)}</span>
            <span class="kitchen-item-price">${formatCurrency(Number(item.unit_price) * Number(item.quantity))}</span>
          </li>`).join('')}
      </ul>

      ${order.note && String(order.note).trim() ? `
        <p class="kitchen-note">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4V5z"/></svg>
          ${escapeHtml(order.note)}
        </p>` : ''}

      <div class="kitchen-total">
        <span>${itemCount} item${itemCount === 1 ? '' : 's'}</span>
        <strong>${formatCurrency(order.total)}</strong>
      </div>

      ${getActions(order)}
      ${message ? `<p class="kitchen-message ${message.error ? 'is-error' : 'is-success'}" role="status">${escapeHtml(message.text)}</p>` : ''}
    </article>`;
}

function renderRestaurantOrders() {
  const searchFiltered = getSearchFilteredOrders();
  const orders = searchFiltered.filter((order) => matchesStatusFilter(order, statusFilter));
  const filtersActive = Boolean(orderSearchInput.value.trim() || orderDateInput.value);
  clearOrderFiltersButton.hidden = !filtersActive && statusFilter === 'all';

  renderStats();
  renderTabs(searchFiltered);

  orderResultsMessage.classList.remove('error');
  orderResultsMessage.textContent = restaurantOrders.length
    ? `Showing ${orders.length} of ${restaurantOrders.length} order${restaurantOrders.length === 1 ? '' : 's'}`
    : '';

  if (!orders.length) {
    ordersContainer.innerHTML = restaurantOrders.length
      ? `<div class="orders-empty">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          <strong>No orders match</strong>
          <span>Try another tab, date or search, or clear the filters.</span>
        </div>`
      : `<div class="orders-empty">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6"/></svg>
          <strong>No orders yet</strong>
          <span>New orders appear here automatically.</span>
        </div>`;
    return;
  }

  ordersContainer.innerHTML = orders.map(renderOrderCard).join('');
}

async function updateOrderStatus(orderId, status) {
  busyOrders.add(orderId);
  cardMessages.delete(orderId);
  renderRestaurantOrders();
  try {
    const response = await fetch(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || 'Update failed. Please try again.');
    if (confirmingOrderId === orderId) confirmingOrderId = null;
    cardMessages.set(orderId, {
      text: status === 'Cancelled' ? 'Order cancelled.' : `Marked as ${status.toLowerCase()}.`,
      error: false
    });
    setTimeout(() => {
      cardMessages.delete(orderId);
      renderRestaurantOrders();
    }, 4000);
  } catch (error) {
    cardMessages.set(orderId, { text: error.message, error: true });
  } finally {
    busyOrders.delete(orderId);
    await loadOrders({ force: true });
  }
}

ordersContainer.addEventListener('click', (event) => {
  const statusButton = event.target.closest('[data-status]');
  if (statusButton) {
    updateOrderStatus(Number(statusButton.dataset.orderId), statusButton.dataset.status);
    return;
  }
  const askCancel = event.target.closest('[data-confirm-cancel]');
  if (askCancel) {
    confirmingOrderId = Number(askCancel.dataset.confirmCancel);
    renderRestaurantOrders();
    ordersContainer.querySelector(`[data-card-id="${confirmingOrderId}"] .order-btn--ghost`)?.focus();
    return;
  }
  const keep = event.target.closest('[data-cancel-confirm]');
  if (keep) {
    const id = Number(keep.dataset.cancelConfirm);
    confirmingOrderId = null;
    renderRestaurantOrders();
    ordersContainer.querySelector(`[data-card-id="${id}"] [data-confirm-cancel]`)?.focus();
  }
});

function setUpdatedText(ok) {
  if (ok) {
    ordersUpdated.textContent = `Updated ${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
  }
  ordersLive?.classList.toggle('is-offline', !ok);
  if (ordersLive) ordersLive.textContent = ok ? 'Live' : 'Offline';
}

async function loadOrders({ force = false } = {}) {
  try {
    const response = await fetch('/api/restaurant/orders');
    const orders = await response.json();
    if (!response.ok) throw new Error(orders.message || 'Unable to load restaurant orders.');
    setUpdatedText(true);
    const signature = JSON.stringify(orders);
    restaurantOrders = orders;
    // Only redraw when something changed, so open confirmations and focus survive the refresh.
    if (force || signature !== ordersSignature) {
      ordersSignature = signature;
      renderRestaurantOrders();
    }
  } catch (error) {
    console.error('Error loading restaurant orders:', error);
    setUpdatedText(false);
    if (!restaurantOrders.length) ordersContainer.innerHTML = '';
    orderResultsMessage.textContent = error.message;
    orderResultsMessage.classList.add('error');
  }
}

ordersTabs.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-orders-tab]');
  if (!tab) return;
  statusFilter = tab.dataset.ordersTab;
  renderRestaurantOrders();
});
ordersTabs.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = Array.from(ordersTabs.querySelectorAll('[data-orders-tab]'));
  const index = tabs.findIndex((tab) => tab.dataset.ordersTab === statusFilter);
  let next = index;
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
  if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = tabs.length - 1;
  event.preventDefault();
  statusFilter = tabs[next].dataset.ordersTab;
  renderRestaurantOrders();
  tabs[next].focus();
});

orderSearchInput.addEventListener('input', renderRestaurantOrders);
orderDateInput.addEventListener('change', renderRestaurantOrders);
clearOrderFiltersButton.addEventListener('click', () => {
  orderSearchInput.value = '';
  orderDateInput.value = '';
  statusFilter = 'all';
  renderRestaurantOrders();
  orderSearchInput.focus();
});

loadOrders();
setInterval(loadOrders, 5000);
// Keep "x min ago" fresh even when no order changes.
setInterval(() => {
  if (confirmingOrderId === null) renderRestaurantOrders();
}, 60000);
