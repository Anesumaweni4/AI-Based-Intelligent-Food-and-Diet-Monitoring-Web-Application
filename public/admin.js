const summaryContainer = document.getElementById('admin-summary');
const ordersContainer = document.getElementById('admin-orders');
const usersContainer = document.getElementById('admin-users');
const scheduleHead = document.getElementById('menu-schedule-head');
const scheduleBody = document.getElementById('menu-schedule-body');
const scheduleStatus = document.getElementById('menu-schedule-status');
const saveScheduleButton = document.getElementById('save-menu-schedule');
const adminPasswordForm = document.getElementById('admin-password-form');
const adminPasswordStatus = document.getElementById('admin-password-status');
const revenueDialog = document.getElementById('revenue-dialog');
const revenueDialogStatus = document.getElementById('revenue-dialog-status');
const revenueSalesBody = document.getElementById('revenue-sales-body');
const revenueSalesTotal = document.getElementById('revenue-sales-total');
const cashierCreateForm = document.getElementById('cashier-create-form');
const cashierCreateStatus = document.getElementById('cashier-create-status');

document.getElementById('close-revenue-dialog').addEventListener('click', () => revenueDialog.close());

cashierCreateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = cashierCreateForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  cashierCreateStatus.textContent = 'Creating cashier account…';
  cashierCreateStatus.classList.remove('error');

  try {
    const response = await fetch('/api/admin/cashiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: document.getElementById('cashier-full-name').value.trim(),
        username: document.getElementById('cashier-username').value.trim(),
        password: document.getElementById('cashier-password').value
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to create cashier account.');
    cashierCreateForm.reset();
    cashierCreateStatus.textContent = result.message;
    await loadSummary();
  } catch (error) {
    cashierCreateStatus.textContent = error.message;
    cashierCreateStatus.classList.add('error');
  } finally {
    submitButton.disabled = false;
  }
});

adminPasswordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = adminPasswordForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  adminPasswordStatus.textContent = 'Updating password…';
  adminPasswordStatus.classList.remove('error');

  try {
    const response = await fetch('/api/admin/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: document.getElementById('current-admin-password').value,
        newPassword: document.getElementById('new-admin-password').value
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to update password');
    adminPasswordForm.reset();
    adminPasswordStatus.textContent = result.message;
  } catch (error) {
    adminPasswordStatus.textContent = error.message;
    adminPasswordStatus.classList.add('error');
  } finally {
    submitButton.disabled = false;
  }
});

function formatCurrency(value) {
  return `$${Number(value).toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function formatSaleDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
}

async function showRevenueDetails() {
  revenueDialogStatus.textContent = 'Loading purchases…';
  revenueDialogStatus.classList.remove('error');
  revenueSalesBody.innerHTML = '';
  revenueSalesTotal.textContent = '$0.00';
  revenueDialog.showModal();

  try {
    const response = await fetch('/api/admin/revenue');
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to load purchases');

    if (!data.sales.length) {
      revenueDialogStatus.textContent = 'No purchases have been recorded yet.';
      return;
    }

    revenueDialogStatus.textContent = '';
    revenueSalesBody.innerHTML = data.sales.map((sale) => `
      <tr>
        <td>#${Number(sale.order_id)}</td>
        <td>${escapeHtml(formatSaleDate(sale.created_at))}</td>
        <td>${escapeHtml(sale.customer_name)}</td>
        <td>${escapeHtml(sale.item_name)}</td>
        <td>${Number(sale.quantity)}</td>
        <td>${formatCurrency(sale.unit_price)}</td>
        <td>${formatCurrency(sale.line_total)}</td>
      </tr>
    `).join('');
    const totalRevenue = data.sales.reduce((total, sale) => total + Number(sale.line_total), 0);
    revenueSalesTotal.textContent = formatCurrency(totalRevenue);
  } catch (error) {
    console.error('Error loading revenue details:', error);
    revenueDialogStatus.textContent = error.message;
    revenueDialogStatus.classList.add('error');
  }
}

async function loadMenuSchedule() {
  try {
    const response = await fetch('/api/admin/menu-schedule');
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to load weekly schedule');

    scheduleHead.innerHTML = `
      <tr>
        <th scope="col">Meal</th>
        ${data.weekdays.map((day) => `<th scope="col">${escapeHtml(day)}</th>`).join('')}
      </tr>
    `;

    if (!data.menuItems.length) {
      scheduleBody.innerHTML = '<tr><td colspan="8">No menu items are available to schedule.</td></tr>';
      saveScheduleButton.disabled = true;
      return;
    }

    const assignedMeals = new Set(data.schedule.map((entry) => `${entry.dayOfWeek}:${entry.menuItemId}`));
    scheduleBody.innerHTML = data.menuItems.map((item) => `
      <tr>
        <th scope="row">
          <span class="schedule-meal-name">${escapeHtml(item.name)}</span>
          <span class="schedule-meal-price">${formatCurrency(item.price)}</span>
        </th>
        ${data.weekdays.map((day, dayOfWeek) => {
          const checked = assignedMeals.has(`${dayOfWeek}:${item.id}`) ? ' checked' : '';
          return `
            <td>
              <label class="schedule-checkbox" aria-label="${escapeHtml(item.name)} served on ${escapeHtml(day)}">
                <input type="checkbox" data-menu-item-id="${Number(item.id)}" data-day-of-week="${dayOfWeek}"${checked}>
                <span class="visually-hidden">${escapeHtml(day)}</span>
              </label>
            </td>
          `;
        }).join('')}
      </tr>
    `).join('');
    saveScheduleButton.disabled = false;
  } catch (error) {
    console.error('Error loading weekly menu schedule:', error);
    scheduleStatus.textContent = error.message;
    scheduleStatus.classList.add('error');
  }
}

async function saveMenuSchedule() {
  const schedule = Array.from(scheduleBody.querySelectorAll('input[type="checkbox"]:checked'))
    .map((checkbox) => ({
      dayOfWeek: Number(checkbox.dataset.dayOfWeek),
      menuItemId: Number(checkbox.dataset.menuItemId)
    }));

  saveScheduleButton.disabled = true;
  scheduleStatus.textContent = 'Saving schedule…';
  scheduleStatus.classList.remove('error');

  try {
    const response = await fetch('/api/admin/menu-schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedule })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to save weekly schedule');
    scheduleStatus.textContent = result.message;
  } catch (error) {
    scheduleStatus.textContent = error.message;
    scheduleStatus.classList.add('error');
  } finally {
    saveScheduleButton.disabled = false;
  }
}

function renderOrders(orders) {
  if (!orders.length) {
    ordersContainer.innerHTML = '<div class="empty-state">No orders yet. New customer orders will appear here.</div>';
    return;
  }

  ordersContainer.innerHTML = orders.map(order => `
    <details class="order-card admin-order-card">
      <summary class="admin-order-summary">
        <span class="admin-order-summary-main">
          <span class="admin-order-number">Order #${Number(order.id)}</span>
          <span class="admin-order-customer">${escapeHtml(order.customer_name)}</span>
        </span>
        <span class="admin-order-summary-end">
          <span class="badge">${escapeHtml(order.status)}</span>
          <strong>${formatCurrency(order.total)}</strong>
        </span>
      </summary>
      <div class="admin-order-details">
        <div class="order-meta">
          <span>Phone: ${escapeHtml(order.phone)}</span>
          <span>${escapeHtml(order.address || 'Pickup order')}</span>
          <span>${escapeHtml(formatSaleDate(order.created_at))}</span>
          <span>Paid by: ${order.payment_method === 'credit' ? 'Student credit' : 'Cash'}</span>
        </div>
        <ul class="order-items">
          ${order.items.map(item => `<li>${escapeHtml(item.item_name)} x ${Number(item.quantity)} — ${formatCurrency(Number(item.unit_price) * Number(item.quantity))}</li>`).join('')}
        </ul>
        <div class="order-meta">
          <span>Total</span>
          <strong>${formatCurrency(order.total)}</strong>
        </div>
      </div>
    </details>
  `).join('');
}

async function loadOrders() {
  try {
    const response = await fetch('/api/orders');
    const orders = await response.json();
    renderOrders(orders);
  } catch (error) {
    console.error('Error loading orders:', error);
    ordersContainer.innerHTML = '<div class="empty-state">Unable to load orders.</div>';
  }
}

async function loadSummary() {
  try {
    const response = await fetch('/api/admin/summary');
    const data = await response.json();

    if (!response.ok) throw new Error(data.message || 'Could not load summary');

    const totals = data.totals || {};
    summaryContainer.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card stat-card-link" data-target="admin-orders" tabindex="0" role="button" aria-label="View total orders">
          <span>Total Orders</span>
          <strong>${totals.total_orders || 0}</strong>
        </div>
        <div class="stat-card">
          <span>Revenue</span>
          <strong>$${Number(totals.revenue || 0).toFixed(2)}</strong>
        </div>
        <div class="stat-card">
          <span>Pending</span>
          <strong>${totals.pending || 0}</strong>
        </div>
        <div class="stat-card">
          <span>Delivered</span>
          <strong>${totals.delivered || 0}</strong>
        </div>
      </div>
    `;

    const users = data.users || [];
    usersContainer.innerHTML = users.length ? users.map(user => {
      const roleLabel = user.role === 'admin' ? 'Admin' : user.role === 'cashier' ? 'Cashier' : 'Client';
      const initials = String(user.full_name || '?')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(name => name.charAt(0))
        .join('')
        .toUpperCase();
      const balance = Number(user.wallet_balance_cents || 0) / 100;

      return `
        <article class="order-card admin-user-card">
          <div class="admin-user-identity">
            <span class="admin-user-avatar" aria-hidden="true">${escapeHtml(initials)}</span>
            <div class="admin-user-info">
              <h4>${escapeHtml(user.full_name)}</h4>
              <span class="admin-user-username">@${escapeHtml(user.username)}</span>
            </div>
            <span class="badge">${roleLabel}</span>
          </div>
          ${user.role === 'staff' ? `
            <div class="admin-user-balance">
              <span>Wallet balance</span>
              <strong>${formatCurrency(balance)}</strong>
            </div>
          ` : ''}
        </article>
      `;
    }).join('') : '<div class="empty-state">No users registered yet.</div>';

    const totalOrdersCard = summaryContainer.querySelector('[data-target="admin-orders"]');
    if (totalOrdersCard) {
      const scrollToOrders = () => {
        const ordersSection = document.getElementById('admin-orders');
        if (ordersSection) {
          ordersSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      };

      totalOrdersCard.addEventListener('click', scrollToOrders);
      totalOrdersCard.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          scrollToOrders();
        }
      });
    }

    const revenueCard = Array.from(summaryContainer.querySelectorAll('.stat-card'))
      .find((card) => card.querySelector('span')?.textContent === 'Revenue');
    if (revenueCard) {
      revenueCard.classList.add('stat-card-link');
      revenueCard.tabIndex = 0;
      revenueCard.setAttribute('role', 'button');
      revenueCard.setAttribute('aria-label', 'View purchased items and revenue details');
      revenueCard.addEventListener('click', showRevenueDetails);
      revenueCard.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          showRevenueDetails();
        }
      });
    }
  } catch (error) {
    summaryContainer.innerHTML = '<div class="empty-state">Unable to load admin data.</div>';
    console.error(error);
  }
}

loadOrders();
loadSummary();
loadMenuSchedule();
saveScheduleButton.addEventListener('click', saveMenuSchedule);
setInterval(loadOrders, 8000);
setInterval(loadSummary, 8000);
