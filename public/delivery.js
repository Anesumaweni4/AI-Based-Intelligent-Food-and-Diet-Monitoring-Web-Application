const ordersContainer = document.getElementById('delivery-orders');

function formatCurrency(value) {
  return `$${Number(value).toFixed(2)}`;
}

function renderDeliveryOrders(orders) {
  if (!orders.length) {
    ordersContainer.innerHTML = '<div class="empty-state">No delivery jobs at the moment.</div>';
    return;
  }

  ordersContainer.innerHTML = orders.map(order => `
    <article class="order-card">
      <div class="order-header">
        <div>
          <h4>Delivery #${order.id}</h4>
          <div class="order-meta">
            <span>${order.customer_name}</span>
            <span>${order.phone}</span>
          </div>
        </div>
        <span class="badge">${order.status}</span>
      </div>

      <div class="order-meta">
        <span>${order.address}</span>
        <span>${formatCurrency(order.total)}</span>
        <span>Payment: ${order.payment_method === 'credit' ? 'Student credit' : 'Cash'}</span>
      </div>

      <ul class="order-items">
        ${order.items.map(item => `<li>${item.item_name} x ${item.quantity}</li>`).join('')}
      </ul>

      <div class="order-actions">
        <button class="status-btn" data-order-id="${order.id}" data-status="Out for Delivery">Out for Delivery</button>
        <button class="status-btn" data-order-id="${order.id}" data-status="Delivered">Delivered</button>
      </div>
    </article>
  `).join('');

  document.querySelectorAll('.status-btn').forEach(button => {
    button.addEventListener('click', async () => {
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
    const response = await fetch('/api/delivery/orders');
    const orders = await response.json();
    renderDeliveryOrders(orders);
  } catch (error) {
    console.error(error);
  }
}

loadOrders();
setInterval(loadOrders, 5000);
