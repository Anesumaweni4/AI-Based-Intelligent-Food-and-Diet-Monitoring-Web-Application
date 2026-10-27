const ordersContainer = document.getElementById('restaurant-orders');
const orderSearchInput = document.getElementById('restaurant-order-search');
const orderDateInput = document.getElementById('restaurant-order-date');
const orderStatusSelect = document.getElementById('restaurant-order-status');
const clearOrderFiltersButton = document.getElementById('restaurant-order-filter-clear');
const orderResultsMessage = document.getElementById('restaurant-order-results');
let restaurantOrders = [];

function formatCurrency(value) {
  return `$${Number(value).toFixed(2)}`;
}

function getOrderLocalDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getFilteredRestaurantOrders() {
  const customerSearch = orderSearchInput.value.trim().toLocaleLowerCase();
  const selectedDate = orderDateInput.value;
  const selectedStatus = orderStatusSelect.value;

  return restaurantOrders.filter(order => {
    const matchesCustomer = !customerSearch ||
      `${order.customer_name} ${order.phone}`.toLocaleLowerCase().includes(customerSearch);
    const matchesDate = !selectedDate || getOrderLocalDate(order.created_at) === selectedDate;
    const matchesStatus = !selectedStatus || order.status === selectedStatus;
    return matchesCustomer && matchesDate && matchesStatus;
  });
}

function renderRestaurantOrders() {
  const orders = getFilteredRestaurantOrders();
  orderResultsMessage.textContent = restaurantOrders.length
    ? `Showing ${orders.length} of ${restaurantOrders.length} order${restaurantOrders.length === 1 ? '' : 's'}.`
    : '';

  if (!orders.length) {
    ordersContainer.innerHTML = restaurantOrders.length
      ? '<div class="empty-state">No orders match these filters. Try changing or clearing your filters.</div>'
      : '<div class="empty-state">No orders yet. New restaurant orders will appear here.</div>';
    return;
  }

  ordersContainer.innerHTML = orders.map(order => `
    <article class="order-card">
      <div class="order-header">
        <div>
          <h4>Order #${order.id}</h4>
          <div class="order-meta">
            <span>${order.customer_name}</span>
            <span>${order.phone}</span>
          </div>
        </div>
        <span class="badge">${order.status}</span>
      </div>

      <div class="order-meta">
        <span>${order.address}</span>
        <span>${new Date(order.created_at).toLocaleString()}</span>
        <span>Payment: ${order.payment_method === 'credit' ? 'Student credit' : 'Cash'}</span>
      </div>

      <ul class="order-items">
        ${order.items.map(item => `<li>${item.item_name} x ${item.quantity} — ${formatCurrency(item.unit_price * item.quantity)}</li>`).join('')}
      </ul>

      ${['Cancelled', 'Collected', 'Delivered'].includes(order.status) ? '' : `
        <div class="order-actions">
          ${order.status === 'Pending' ? `<button class="status-btn" data-order-id="${order.id}" data-status="Preparing">Mark Preparing</button>` : ''}
          ${['Pending', 'Preparing'].includes(order.status) ? `<button class="status-btn" data-order-id="${order.id}" data-status="Ready for Pickup">Ready for Pickup</button>` : ''}
          ${order.status === 'Ready for Pickup' ? `<button class="status-btn" data-order-id="${order.id}" data-status="Collected">Mark Collected</button>` : ''}
          <button class="status-btn" data-order-id="${order.id}" data-status="Cancelled">Cancel and refund credit</button>
        </div>
      `}
    </article>
  `).join('');

  document.querySelectorAll('.status-btn').forEach(button => {
    button.addEventListener('click', async () => {
      if (button.dataset.status === 'Cancelled' &&
          !window.confirm('Cancel this order and refund the student’s credit?')) {
        return;
      }
      try {
        const response = await fetch(`/api/orders/${button.dataset.orderId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: button.dataset.status })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Update failed');
        loadOrders();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

async function loadOrders() {
  try {
    const response = await fetch('/api/restaurant/orders');
    const orders = await response.json();
    if (!response.ok) throw new Error(orders.message || 'Unable to load restaurant orders.');
    restaurantOrders = orders;
    orderResultsMessage.classList.remove('error');
    renderRestaurantOrders();
  } catch (error) {
    console.error('Error loading restaurant orders:', error);
    orderResultsMessage.textContent = error.message;
    orderResultsMessage.classList.add('error');
  }
}

orderSearchInput.addEventListener('input', renderRestaurantOrders);
orderDateInput.addEventListener('change', renderRestaurantOrders);
orderStatusSelect.addEventListener('change', renderRestaurantOrders);
clearOrderFiltersButton.addEventListener('click', () => {
  orderSearchInput.value = '';
  orderDateInput.value = '';
  orderStatusSelect.value = '';
  renderRestaurantOrders();
  orderSearchInput.focus();
});

loadOrders();
setInterval(loadOrders, 5000);
