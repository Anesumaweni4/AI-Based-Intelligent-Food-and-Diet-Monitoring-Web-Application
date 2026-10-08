const ordersContainer = document.getElementById('restaurant-orders');

function formatCurrency(value) {
  return `$${Number(value).toFixed(2)}`;
}

function renderRestaurantOrders(orders) {
  if (!orders.length) {
    ordersContainer.innerHTML = '<div class="empty-state">No orders yet. New restaurant orders will appear here.</div>';
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
    renderRestaurantOrders(orders);
  } catch (error) {
    console.error(error);
  }
}

loadOrders();
setInterval(loadOrders, 5000);
