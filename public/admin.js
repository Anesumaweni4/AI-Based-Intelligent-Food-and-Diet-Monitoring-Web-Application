const summaryContainer = document.getElementById('admin-summary');
const ordersContainer = document.getElementById('admin-orders');
const usersContainer = document.getElementById('admin-users');
const userStatsContainer = document.getElementById('admin-user-stats');
const searchForm = document.getElementById('student-search-form');
const searchInput = document.getElementById('student-search');
const searchResults = document.getElementById('student-search-results');
const depositForm = document.getElementById('deposit-form');
const selectedStudentLabel = document.getElementById('selected-student');
const depositAmount = document.getElementById('deposit-amount');
const cashierStatus = document.getElementById('cashier-status');
const transactionsContainer = document.getElementById('credit-transactions');
const stockReceiptForm = document.getElementById('stock-receipt-form');
const stockMenuItem = document.getElementById('stock-menu-item');
const stockQuantity = document.getElementById('stock-quantity');
const stockStatus = document.getElementById('stock-status');
const inventoryContainer = document.getElementById('cashier-inventory');
const stockAlertsContainer = document.getElementById('stock-alerts');
const stockReceiptsContainer = document.getElementById('stock-receipts');
const STOCK_ALERT_THRESHOLD = 0;
let selectedStudent = null;
const accountDialog = document.getElementById('account-dialog');
const accountDialogTitle = document.getElementById('account-dialog-title');
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
const orderDialog = document.getElementById('order-dialog');
const orderDialogTitle = document.getElementById('order-dialog-title');
const orderDialogContent = document.getElementById('order-dialog-content');
const orderDialogStatus = document.getElementById('order-dialog-status');
let activeOrderDetails = null;
const pendingOrdersDialog = document.getElementById('pending-orders-dialog');
const pendingOrdersStatus = document.getElementById('pending-orders-status');
const pendingOrdersList = document.getElementById('pending-orders-list');
const cashierCreateForm = document.getElementById('cashier-create-form');
const cashierCreateStatus = document.getElementById('cashier-create-status');
const clientFeedbackList = document.getElementById('client-feedback-list');
const clientFeedbackStatus = document.getElementById('client-feedback-status');
let activeUserFilter = null;
let directoryUsers = [];

async function readStockApiResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`The stock API returned a webpage (HTTP ${response.status}). Open the dashboard from the running app at http://localhost:3000, not from VS Code Live Server or a file link.`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`The stock API returned invalid data (HTTP ${response.status}). Restart the app and try again.`);
  }
}

userStatsContainer.addEventListener('click', (event) => {
  const button = event.target.closest('[data-user-filter]');
  if (!button) return;

  activeUserFilter = button.dataset.userFilter;
  renderUserDirectory();
});

usersContainer.addEventListener('submit', async (event) => {
  const form = event.target.closest('.admin-user-email-form, .admin-user-whatsapp-form');
  if (!form) return;
  event.preventDefault();

  const userId = Number(form.dataset.userId);
  const submitButton = form.querySelector('button[type="submit"]');
  if (form.classList.contains('admin-user-whatsapp-form')) {
    const phoneInput = form.querySelector('input[type="tel"]');
    const confirmation = form.querySelector('input[type="checkbox"]');
    const status = form.querySelector('[role="status"]');
    status.textContent = 'Saving…';
    status.classList.remove('error');
    submitButton.disabled = true;
    try {
      const response = await fetch(`/api/admin/users/${userId}/recovery-whatsapp`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phoneInput.value.trim(),
          confirmed: confirmation.checked
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to save WhatsApp recovery number.');
      const user = directoryUsers.find((entry) => Number(entry.id) === userId);
      if (user) user.recovery_whatsapp = phoneInput.value.trim() || null;
      status.textContent = result.message;
      confirmation.checked = false;
    } catch (error) {
      status.textContent = error.message;
      status.classList.add('error');
    } finally {
      submitButton.disabled = false;
    }
    return;
  }

  const emailInput = form.querySelector('input[type="email"]');
  const status = form.querySelector('[role="status"]');
  status.textContent = 'Saving…';
  status.classList.remove('error');
  submitButton.disabled = true;
  try {
    const response = await fetch(`/api/admin/users/${userId}/email`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailInput.value.trim() })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to save recovery email.');
    const user = directoryUsers.find((entry) => Number(entry.id) === userId);
    if (user) user.email = emailInput.value.trim().toLowerCase();
    status.textContent = result.message;
  } catch (error) {
    status.textContent = error.message;
    status.classList.add('error');
  } finally {
    submitButton.disabled = false;
  }
});

document.getElementById('close-revenue-dialog').addEventListener('click', () => revenueDialog.close());
document.getElementById('close-order-dialog').addEventListener('click', () => orderDialog.close());
document.getElementById('close-account-dialog').addEventListener('click', () => accountDialog.close());
document.getElementById('close-pending-orders-dialog').addEventListener('click', () => pendingOrdersDialog.close());
accountDialog.addEventListener('click', (event) => {
  if (event.target === accountDialog) accountDialog.close();
});
accountDialog.addEventListener('close', () => {
  activeUserFilter = null;
  userStatsContainer.querySelectorAll('[data-user-filter]').forEach((button) => {
    button.setAttribute('aria-expanded', 'false');
  });
});
orderDialog.addEventListener('click', (event) => {
  if (event.target === orderDialog) orderDialog.close();
});
pendingOrdersDialog.addEventListener('click', (event) => {
  if (event.target === pendingOrdersDialog) pendingOrdersDialog.close();
});
pendingOrdersList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-pending-order-id]');
  if (!button) return;

  try {
    const response = await fetch('/api/orders');
    const orders = await response.json();
    if (!response.ok) throw new Error(orders.message || 'Unable to load order details.');
    const selectedOrder = orders.find((order) => Number(order.id) === Number(button.dataset.pendingOrderId));
    if (!selectedOrder) throw new Error('This order is no longer available.');
    pendingOrdersDialog.close();
    showOrderDetails(selectedOrder);
  } catch (error) {
    pendingOrdersStatus.textContent = error.message;
    pendingOrdersStatus.classList.add('error');
  }
});
orderDialogContent.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-next-order-status]');
  if (!button) return;

  button.disabled = true;
  orderDialogStatus.textContent = 'Updating order…';
  orderDialogStatus.classList.remove('error');
  try {
    const response = await fetch(`/api/orders/${button.dataset.orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: button.dataset.nextOrderStatus })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to update order status.');

    const updatedOrder = result.order;
    if (activeOrderDetails && Number(activeOrderDetails.id) === Number(updatedOrder.id)) {
      activeOrderDetails.status = updatedOrder.status;
      showOrderDetails(activeOrderDetails, result.message);
    }
    const orderRow = ordersContainer.querySelector(`[data-order-id="${Number(updatedOrder.id)}"]`);
    const orderBadge = orderRow && orderRow.querySelector('.badge');
    if (orderBadge) orderBadge.textContent = updatedOrder.status;
    await loadSummary();
  } catch (error) {
    orderDialogStatus.textContent = error.message;
    orderDialogStatus.classList.add('error');
    button.disabled = false;
  }
});

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

function formatCredit(cents) {
  return formatCurrency(Number(cents) / 100);
}

function renderUserDirectory() {
  const buttons = Array.from(userStatsContainer.querySelectorAll('[data-user-filter]'));
  buttons.forEach((button) => {
    const expanded = button.dataset.userFilter === activeUserFilter;
    button.setAttribute('aria-expanded', String(expanded));
  });

  const selectedButton = buttons.find((button) => button.dataset.userFilter === activeUserFilter);
  if (!selectedButton) {
    return;
  }

  accountDialogTitle.textContent = selectedButton.dataset.userLabel;
  const selectedUsers = activeUserFilter === 'all'
    ? directoryUsers
    : directoryUsers.filter((user) => user.role === activeUserFilter);

  usersContainer.setAttribute('aria-label', `${selectedButton.dataset.userLabel} account details`);
  usersContainer.innerHTML = selectedUsers.length
    ? `
      <table class="admin-user-table">
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col">Username</th>
            <th scope="col">Role</th>
            <th scope="col">Recovery email</th>
            <th scope="col">WhatsApp recovery</th>
            <th scope="col">Wallet balance</th>
          </tr>
        </thead>
        <tbody>
          ${selectedUsers.map((user) => {
            const roleLabel = user.role === 'admin' ? 'Admin' : user.role === 'cashier' ? 'Cashier' : 'Client';
            const roleClass = user.role === 'admin' ? 'admin' : user.role === 'cashier' ? 'cashier' : 'client';
            const initials = String(user.full_name || '?')
              .trim()
              .split(/\s+/)
              .slice(0, 2)
              .map((name) => name.charAt(0))
              .join('')
              .toUpperCase();
            const balance = Number(user.wallet_balance_cents || 0) / 100;

            return `
              <tr>
                <td>
                  <div class="admin-user-table-account">
                    <span class="admin-user-avatar" aria-hidden="true">${escapeHtml(initials)}</span>
                    <strong>${escapeHtml(user.full_name)}</strong>
                  </div>
                </td>
                <td>@${escapeHtml(user.username)}</td>
                <td><span class="admin-user-role role-${roleClass}">${roleLabel}</span></td>
                <td>
                  ${user.role === 'staff' ? `
                    <form class="admin-user-email-form" data-user-id="${Number(user.id)}">
                      <label class="visually-hidden" for="recovery-email-${Number(user.id)}">Recovery email for ${escapeHtml(user.full_name)}</label>
                      <input id="recovery-email-${Number(user.id)}" type="email" maxlength="255" autocomplete="email" value="${escapeHtml(user.email || '')}" placeholder="student@example.com" required />
                      <button type="submit" class="admin-user-email-save">Save</button>
                      <span role="status" aria-live="polite"></span>
                    </form>
                  ` : escapeHtml(user.email || '—')}
                </td>
                <td>
                  ${user.role === 'staff' ? `
                    <form class="admin-user-whatsapp-form" data-user-id="${Number(user.id)}">
                      <label class="visually-hidden" for="recovery-whatsapp-${Number(user.id)}">WhatsApp recovery number for ${escapeHtml(user.full_name)}</label>
                      <input id="recovery-whatsapp-${Number(user.id)}" type="tel" maxlength="16" inputmode="tel" pattern="\\+[1-9][0-9]{7,14}" value="${escapeHtml(user.recovery_whatsapp || '')}" placeholder="+263771234567" />
                      <label class="admin-user-whatsapp-confirm">
                        <input type="checkbox" />
                        Confirmed with client
                      </label>
                      <button type="submit" class="admin-user-email-save">Save number</button>
                      <span role="status" aria-live="polite"></span>
                    </form>
                  ` : '—'}
                </td>
                <td class="admin-user-table-balance">${user.role === 'staff' ? formatCurrency(balance) : '—'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `
    : '<div class="empty-state">No accounts in this category yet.</div>';
  if (!accountDialog.open) accountDialog.showModal();
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
  const timestamp = typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const date = new Date(timestamp);
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
      revenueDialogStatus.textContent = 'No orders have been collected today.';
      return;
    }

    revenueDialogStatus.textContent = '';
    revenueSalesBody.innerHTML = data.sales.map((sale) => `
      <tr>
        <td>#${Number(sale.order_id)}</td>
        <td>${escapeHtml(formatSaleDate(sale.collected_at))}</td>
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

async function loadTransactions() {
  try {
    const response = await fetch('/api/cashier/transactions');
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to load credit activity.');
    transactionsContainer.innerHTML = result.accounts.length
      ? result.accounts.map((account) => `
          <article class="order-card credit-account-card">
            <div class="credit-account-summary">
              <div>
                <h4>${escapeHtml(account.student_name)} (@${escapeHtml(account.student_username)})</h4>
              </div>
              <div class="credit-account-balance">
                <span>Wallet balance</span>
                <strong>${formatCredit(account.balance_cents)}</strong>
              </div>
            </div>
            ${account.transactions.length ? `
              <details class="credit-account-history">
                <summary>Recent transactions (${account.transactions.length})</summary>
                <div class="credit-account-transactions">
                  ${account.transactions.map((entry) => `
                    <div class="credit-account-transaction">
                      <div>
                        <strong>${escapeHtml(entry.type)}</strong>
                        <span>${escapeHtml(entry.recorded_by || 'System')} · ${new Date(entry.created_at).toLocaleString()}</span>
                      </div>
                      <strong class="${Number(entry.amount_cents) < 0 ? 'credit-debit' : 'credit-addition'}">${formatCredit(entry.amount_cents)}</strong>
                    </div>
                  `).join('')}
                </div>
              </details>
            ` : '<span class="credit-account-no-history">No credit transactions yet.</span>'}
          </article>
        `).join('')
      : '<div class="empty-state">No credit activity has been recorded yet.</div>';
  } catch (error) {
    transactionsContainer.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

async function loadInventory() {
  stockStatus.textContent = 'Loading stock inventory…';
  stockStatus.classList.remove('error');
  try {
    const response = await fetch('/api/cashier/inventory');
    const result = await readStockApiResponse(response);
    if (!response.ok) throw new Error(result.message || 'Unable to load stock inventory.');

    stockMenuItem.innerHTML = result.items.length
      ? `<option value="">Choose a menu item</option>${result.items.map((item) => `
          <option value="${Number(item.id)}">${escapeHtml(item.name)}</option>
        `).join('')}`
      : '<option value="">No menu items available</option>';
    stockMenuItem.disabled = !result.items.length;
    const outOfStockItems = result.items.filter((item) => Number(item.stock_quantity) <= STOCK_ALERT_THRESHOLD);
    const alertContent = outOfStockItems.length
      ? `<strong>Out of stock alert: ${outOfStockItems.length} item${outOfStockItems.length === 1 ? '' : 's'} need restocking.</strong>
         <ul>${outOfStockItems.map((item) => `<li>${escapeHtml(item.name)}</li>`).join('')}</ul>`
      : '';
    stockAlertsContainer.hidden = outOfStockItems.length === 0;
    if (stockAlertsContainer.innerHTML !== alertContent) {
      stockAlertsContainer.innerHTML = alertContent;
    }
    inventoryContainer.innerHTML = result.items.length
      ? result.items.map((item) => `
          <article class="cashier-inventory-card ${Number(item.stock_quantity) <= STOCK_ALERT_THRESHOLD ? 'out-of-stock' : ''}">
            <span>${escapeHtml(item.category || 'Menu item')}</span>
            <strong>${escapeHtml(item.name)}</strong>
            ${Number(item.stock_quantity) <= STOCK_ALERT_THRESHOLD ? '<span class="stock-alert-badge">Out of stock</span>' : ''}
            <b>${Number(item.stock_quantity)} <small>in stock</small></b>
          </article>
        `).join('')
      : '<div class="empty-state">No menu items are available.</div>';
    stockReceiptsContainer.innerHTML = result.receipts.length
      ? result.receipts.map((receipt) => `
          <article class="cashier-stock-receipt">
            <div><strong>${Number(receipt.quantity_change) > 0 ? '+' : '−'}${Math.abs(Number(receipt.quantity_change))} ${escapeHtml(receipt.item_name)}</strong>
              <span>${receipt.type === 'used' ? 'Used' : 'Received'} by ${escapeHtml(receipt.received_by || 'staff')}</span></div>
            <time>${escapeHtml(new Date(receipt.created_at).toLocaleString())}</time>
          </article>
        `).join('')
      : '<div class="empty-state">No stock activity has been recorded yet.</div>';
    stockStatus.textContent = '';
  } catch (error) {
    stockStatus.textContent = error.message;
    stockStatus.classList.add('error');
    stockAlertsContainer.hidden = true;
    stockAlertsContainer.innerHTML = '';
    inventoryContainer.innerHTML = '<div class="empty-state">Unable to load stock levels.</div>';
    stockReceiptsContainer.innerHTML = '';
  }
}

stockReceiptForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const action = event.submitter?.value || 'received';
  if (!['received', 'used'].includes(action)) return;
  const isRemoval = action === 'used';
  const buttons = stockReceiptForm.querySelectorAll('button[type="submit"]');
  buttons.forEach((button) => { button.disabled = true; });
  stockStatus.textContent = isRemoval ? 'Removing used stock…' : 'Recording received stock…';
  stockStatus.classList.remove('error');
  try {
    const response = await fetch(isRemoval ? '/api/cashier/stock-usage' : '/api/cashier/stock-receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        menuItemId: stockMenuItem.value,
        quantity: stockQuantity.value
      })
    });
    const result = await readStockApiResponse(response);
    if (!response.ok) throw new Error(result.message || (isRemoval ? 'Unable to remove stock.' : 'Unable to record received stock.'));
    stockReceiptForm.reset();
    stockStatus.textContent = result.message;
    await loadInventory();
    stockStatus.textContent = result.message;
  } catch (error) {
    stockStatus.textContent = error.message;
    stockStatus.classList.add('error');
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
});

searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  selectedStudent = null;
  depositForm.hidden = true;
  cashierStatus.textContent = 'Searching student accounts…';
  cashierStatus.classList.remove('error');
  searchResults.innerHTML = '';

  try {
    const response = await fetch(`/api/cashier/students?search=${encodeURIComponent(searchInput.value.trim())}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to search student accounts.');
    cashierStatus.textContent = result.students.length ? 'Select the correct student account.' : 'No matching student accounts.';
    searchResults.innerHTML = result.students.map((student) => `
      <button type="button" class="order-card student-result" data-username="${escapeHtml(student.username)}" data-name="${escapeHtml(student.fullName)}" data-balance="${Number(student.balanceCents)}">
        <strong>${escapeHtml(student.fullName)}</strong>
        <span>@${escapeHtml(student.username)}</span>
        <span>Balance: ${formatCredit(student.balanceCents)}</span>
      </button>
    `).join('');
  } catch (error) {
    cashierStatus.textContent = error.message;
    cashierStatus.classList.add('error');
  }
});

searchResults.addEventListener('click', (event) => {
  const button = event.target.closest('.student-result');
  if (!button) return;
  selectedStudent = { username: button.dataset.username, fullName: button.dataset.name };
  selectedStudentLabel.textContent = `${selectedStudent.fullName} (@${selectedStudent.username})`;
  depositAmount.value = '';
  depositForm.hidden = false;
  cashierStatus.textContent = 'Confirm the student name before recording cash.';
});

depositForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedStudent) return;
  const submitButton = depositForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  cashierStatus.textContent = 'Recording deposit…';
  cashierStatus.classList.remove('error');

  try {
    const response = await fetch('/api/cashier/deposits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: selectedStudent.username,
        amount: depositAmount.value
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to record deposit.');
    depositForm.reset();
    depositForm.hidden = true;
    cashierStatus.textContent = `${result.message} New balance: ${formatCredit(result.student.balanceCents)}.`;
    selectedStudent = null;
    await loadTransactions();
  } catch (error) {
    cashierStatus.textContent = error.message;
    cashierStatus.classList.add('error');
  } finally {
    submitButton.disabled = false;
  }
});

function renderOrders(orders) {
  if (!orders.length) {
    ordersContainer.innerHTML = '<div class="empty-state">No orders yet. New customer orders will appear here.</div>';
    return;
  }

  ordersContainer.innerHTML = orders.map(order => `
    <article class="order-card admin-order-card">
      <button type="button" class="admin-order-summary" data-order-id="${Number(order.id)}" aria-label="View details for order ${Number(order.id)}">
        <span class="admin-order-summary-main">
          <span class="admin-order-number">Order #${Number(order.id)}</span>
          <span class="admin-order-customer">${escapeHtml(order.customer_name)}</span>
        </span>
        <span class="admin-order-summary-end">
          <span class="badge">${escapeHtml(order.status)}</span>
          <strong>${formatCurrency(order.total)}</strong>
        </span>
        <span class="admin-order-open-label">View order</span>
      </button>
    </article>
  `).join('');

  ordersContainer.querySelectorAll('[data-order-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const order = orders.find((entry) => Number(entry.id) === Number(button.dataset.orderId));
      if (!order) return;
      showOrderDetails(order);
    });
  });
}

function showOrderDetails(order, statusMessage = '') {
  activeOrderDetails = order;
  const canMarkCollected = ['Pending', 'Preparing', 'Ready for Pickup'].includes(order.status);
  orderDialogTitle.textContent = `Order #${Number(order.id)}`;
  orderDialogStatus.textContent = statusMessage;
  orderDialogStatus.classList.remove('error');
  orderDialogContent.innerHTML = `
    ${order.items.length ? `
      <div class="admin-order-dialog-table-wrap">
        <table class="schedule-table admin-order-dialog-table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Qty</th>
              <th scope="col">Unit price</th>
              <th scope="col">Line total</th>
            </tr>
          </thead>
          <tbody>
            ${order.items.map((item) => `
              <tr>
                <td>${escapeHtml(item.item_name)}</td>
                <td>${Number(item.quantity)}</td>
                <td>${formatCurrency(item.unit_price)}</td>
                <td>${formatCurrency(Number(item.unit_price) * Number(item.quantity))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : '<p class="admin-order-dialog-empty">No item details are available for this order.</p>'}
    <div class="admin-order-dialog-meta-row">
      <div><span>Customer</span><strong>${escapeHtml(order.customer_name)}</strong></div>
      <div><span>Date</span><strong>${escapeHtml(formatSaleDate(order.created_at))}</strong></div>
      <div><span>Payment</span><strong>${order.payment_method === 'credit' ? 'Student credit' : 'Cash'}</strong></div>
      <div><span>Status</span><strong>${escapeHtml(order.status)}</strong></div>
    </div>
    <div class="admin-order-dialog-total"><span>Order total</span><strong>${formatCurrency(order.total)}</strong></div>
    ${canMarkCollected ? `
      <div class="admin-order-dialog-actions">
        <button type="button" class="submit-btn" data-order-id="${Number(order.id)}" data-next-order-status="Collected">
          Mark Collected
        </button>
      </div>
    ` : ''}
  `;
  if (!orderDialog.open) orderDialog.showModal();
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
          <span>Today's Revenue</span>
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

    const summaryDropdown = document.createElement('div');
    summaryDropdown.className = 'admin-summary-dropdown';
    summaryDropdown.hidden = true;
    summaryContainer.appendChild(summaryDropdown);

    const users = data.users || [];
    const clientCount = users.filter(user => user.role === 'staff').length;
    const cashierCount = users.filter(user => user.role === 'cashier').length;
    const adminCount = users.filter(user => user.role === 'admin').length;
    const userCategories = [
      { key: 'all', label: 'Total accounts', count: users.length },
      { key: 'staff', label: 'Clients', count: clientCount },
      { key: 'cashier', label: 'Cashiers', count: cashierCount },
      { key: 'admin', label: 'Administrators', count: adminCount }
    ];
    userStatsContainer.innerHTML = userCategories.map(({ key, label, count }) => `
      <button type="button" class="admin-user-stat" data-user-filter="${key}" data-user-label="${label}"
        aria-controls="admin-users" aria-expanded="false">
        <span>${label}</span>
        <strong>${count}</strong>
        <span class="admin-user-stat-hint" aria-hidden="true">View accounts</span>
      </button>
    `).join('');

    directoryUsers = users;
    if (!accountDialog.open) renderUserDirectory();

    const totalOrdersCard = summaryContainer.querySelector('[data-target="admin-orders"]');
    const pendingOrdersCard = Array.from(summaryContainer.querySelectorAll('.stat-card'))
      .find((card) => card.querySelector('span')?.textContent === 'Pending');
    if (pendingOrdersCard) {
      pendingOrdersCard.classList.add('stat-card-link');
      pendingOrdersCard.tabIndex = 0;
      pendingOrdersCard.setAttribute('role', 'button');
      pendingOrdersCard.setAttribute('aria-label', 'View pending orders');
      pendingOrdersCard.addEventListener('click', showPendingOrders);
      pendingOrdersCard.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          showPendingOrders();
        }
      });
    }

    if (totalOrdersCard) {
      const renderSummaryDropdown = (orders) => {
        const dropdown = summaryContainer.querySelector('.admin-summary-dropdown');
        if (!dropdown) return;

        if (!orders.length) {
          dropdown.innerHTML = '<div class="admin-summary-empty">No orders yet.</div>';
          dropdown.hidden = false;
          return;
        }

        dropdown.innerHTML = orders.slice(0, 5).map((order) => `
          <div class="admin-summary-order-row">
            <div>
              <strong>Order #${Number(order.id)}</strong>
              <span>${escapeHtml(order.customer_name)}</span>
            </div>
            <span class="badge admin-summary-badge">${escapeHtml(order.status)}</span>
            <strong>${formatCurrency(order.total)}</strong>
          </div>
        `).join('');
        dropdown.hidden = false;
      };

      const toggleOrdersDropdown = async () => {
        const dropdown = summaryContainer.querySelector('.admin-summary-dropdown');
        if (!dropdown) return;

        if (!dropdown.hidden) {
          dropdown.hidden = true;
          return;
        }

        try {
          const response = await fetch('/api/orders');
          const orders = await response.json();
          if (!response.ok) throw new Error('Unable to load recent orders.');
          renderSummaryDropdown(Array.isArray(orders) ? orders : []);
        } catch (error) {
          dropdown.innerHTML = `<div class="admin-summary-empty">${escapeHtml(error.message || 'Unable to load recent orders.')}</div>`;
          dropdown.hidden = false;
        }
      };

      const scrollToOrders = () => {
        const ordersSection = document.getElementById('admin-orders');
        if (ordersSection) {
          ordersSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      };

      totalOrdersCard.addEventListener('click', async () => {
        await toggleOrdersDropdown();
        scrollToOrders();
      });
      totalOrdersCard.addEventListener('keydown', async (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          await toggleOrdersDropdown();
          scrollToOrders();
        }
      });
    }

    const revenueCard = Array.from(summaryContainer.querySelectorAll('.stat-card'))
      .find((card) => card.querySelector('span')?.textContent === "Today's Revenue");
    if (revenueCard) {
      revenueCard.classList.add('stat-card-link');
      revenueCard.tabIndex = 0;
      revenueCard.setAttribute('role', 'button');
      revenueCard.setAttribute('aria-label', "View today's collected purchases and revenue details");
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

async function showPendingOrders() {
  pendingOrdersStatus.textContent = 'Loading pending orders…';
  pendingOrdersStatus.classList.remove('error');
  pendingOrdersList.innerHTML = '';
  pendingOrdersDialog.showModal();

  try {
    const response = await fetch('/api/orders');
    const orders = await response.json();
    if (!response.ok) throw new Error(orders.message || 'Unable to load pending orders.');

    const pendingOrders = orders.filter((order) => order.status === 'Pending');
    if (!pendingOrders.length) {
      pendingOrdersStatus.textContent = 'There are no pending orders right now.';
      return;
    }

    pendingOrdersStatus.textContent = `${pendingOrders.length} pending order${pendingOrders.length === 1 ? '' : 's'}. Select an order to view its details.`;
    pendingOrdersList.innerHTML = pendingOrders.map((order) => `
      <button type="button" class="order-card admin-order-summary" data-pending-order-id="${Number(order.id)}">
        <span class="admin-order-summary-main">
          <span class="admin-order-number">Order #${Number(order.id)}</span>
          <span class="admin-order-customer">${escapeHtml(order.customer_name)}</span>
        </span>
        <span class="admin-order-summary-end">
          <span class="badge">${escapeHtml(order.status)}</span>
          <strong>${formatCurrency(order.total)}</strong>
        </span>
        <span class="admin-order-open-label">View order</span>
      </button>
    `).join('');
  } catch (error) {
    console.error('Error loading pending orders:', error);
    pendingOrdersStatus.textContent = error.message;
    pendingOrdersStatus.classList.add('error');
  }
}

function renderClientFeedback(feedback) {
  if (!feedback.length) {
    clientFeedbackList.innerHTML = '<div class="empty-state">No client feedback has been submitted yet.</div>';
    return;
  }
  const categoryLabels = {
    food: 'Food',
    order: 'Order',
    service: 'Service',
    website: 'Website',
    other: 'Other'
  };
  clientFeedbackList.innerHTML = `
    <details class="client-feedback-dropdown">
      <summary>View ${feedback.length} feedback submission${feedback.length === 1 ? '' : 's'}</summary>
      <div class="client-feedback-dropdown-list">
        ${feedback.map((entry) => `
          <article class="client-feedback-card">
            <div class="client-feedback-heading">
              <div>
                <strong>${escapeHtml(entry.full_name)} (@${escapeHtml(entry.username)})</strong>
                <span>${escapeHtml(categoryLabels[entry.category] || entry.category)} · ${escapeHtml(formatSaleDate(entry.created_at))}</span>
              </div>
              <span class="badge client-feedback-badge">${escapeHtml(entry.status)}</span>
            </div>
            <p class="client-feedback-message">${escapeHtml(entry.message)}</p>
            <form class="client-feedback-status-form" data-feedback-id="${Number(entry.id)}">
              <label for="feedback-status-${Number(entry.id)}">Review status</label>
              <select id="feedback-status-${Number(entry.id)}" name="status">
                <option value="new" ${entry.status === 'new' ? 'selected' : ''}>New</option>
                <option value="reviewing" ${entry.status === 'reviewing' ? 'selected' : ''}>Reviewing</option>
                <option value="resolved" ${entry.status === 'resolved' ? 'selected' : ''}>Resolved</option>
              </select>
              <button type="submit" class="admin-user-email-save">Update</button>
            </form>
          </article>
        `).join('')}
      </div>
    </details>
  `;
}

async function loadClientFeedback() {
  try {
    const response = await fetch('/api/admin/feedback');
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to load client feedback.');
    renderClientFeedback(Array.isArray(result) ? result : []);
    clientFeedbackStatus.textContent = '';
    clientFeedbackStatus.classList.remove('error');
  } catch (error) {
    clientFeedbackStatus.textContent = error.message;
    clientFeedbackStatus.classList.add('error');
  }
}

clientFeedbackList.addEventListener('submit', async (event) => {
  const form = event.target.closest('.client-feedback-status-form');
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  clientFeedbackStatus.textContent = 'Updating feedback status…';
  clientFeedbackStatus.classList.remove('error');
  try {
    const response = await fetch(`/api/admin/feedback/${Number(form.dataset.feedbackId)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: form.elements.status.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to update feedback status.');
    await loadClientFeedback();
    clientFeedbackStatus.textContent = result.message;
  } catch (error) {
    clientFeedbackStatus.textContent = error.message;
    clientFeedbackStatus.classList.add('error');
  } finally {
    button.disabled = false;
  }
});

loadOrders();
loadSummary();
loadClientFeedback();
loadMenuSchedule();
loadInventory();
loadTransactions();
saveScheduleButton.addEventListener('click', saveMenuSchedule);
setInterval(loadOrders, 8000);
setInterval(loadSummary, 8000);
setInterval(loadClientFeedback, 15000);
setInterval(loadInventory, 12000);
setInterval(loadTransactions, 12000);
