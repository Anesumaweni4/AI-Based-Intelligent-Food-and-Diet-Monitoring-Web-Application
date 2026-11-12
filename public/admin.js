const summaryContainer = document.getElementById('admin-summary');
const ordersContainer = document.getElementById('admin-orders');
const adminOrderSearchInput = document.getElementById('admin-order-search');
const adminOrderDateInput = document.getElementById('admin-order-date');
const adminOrderStatusSelect = document.getElementById('admin-order-status');
const clearAdminOrderFiltersButton = document.getElementById('admin-order-filter-clear');
const downloadOrderHistoryButton = document.getElementById('download-order-history');
const adminOrderResultsMessage = document.getElementById('admin-order-results');
let allOrders = [];
let lastObservedOrderDate = '';
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
const stockItemSelect = document.getElementById('inventory-item-select');
const stockQuantity = document.getElementById('stock-quantity');
const stockUnit = document.getElementById('stock-unit');
const stockStatus = document.getElementById('stock-status');
const stockLedgerBody = document.getElementById('stock-ledger-body');
let selectedStudent = null;
const accountDialog = document.getElementById('account-dialog');
const accountDialogTitle = document.getElementById('account-dialog-title');
const scheduleHead = document.getElementById('menu-schedule-head');
const scheduleBody = document.getElementById('menu-schedule-body');
const scheduleStatus = document.getElementById('menu-schedule-status');
const scheduleSearchInput = document.getElementById('menu-schedule-search');
const scheduleSearchEmpty = document.getElementById('menu-schedule-search-empty');
const saveScheduleButton = document.getElementById('save-menu-schedule');
const menuPlateStatus = document.getElementById('menu-stock-status');
const saveMenuStockButton = document.getElementById('save-menu-stock');
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
const totalOrdersDialog = document.getElementById('total-orders-dialog');
const totalOrdersStatus = document.getElementById('total-orders-status');
const totalOrdersList = document.getElementById('total-orders-list');
const cashierCreateForm = document.getElementById('cashier-create-form');
const cashierCreateStatus = document.getElementById('cashier-create-status');
const clientFeedbackList = document.getElementById('client-feedback-list');
const clientFeedbackStatus = document.getElementById('client-feedback-status');
const monthlyBillingPeriodInput = document.getElementById('monthly-billing-period');
const generateMonthlyInvoicesButton = document.getElementById('generate-monthly-invoices');
const monthlyBillingStatus = document.getElementById('monthly-billing-status');
const monthlyInvoicesContainer = document.getElementById('monthly-invoices');
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
  const form = event.target.closest('.admin-user-email-form, .admin-user-whatsapp-form, .admin-user-monthly-form');
  if (!form) return;
  event.preventDefault();

  const userId = Number(form.dataset.userId);
  const submitButton = form.querySelector('button[type="submit"]');
  if (form.classList.contains('admin-user-monthly-form')) {
    const approvalInput = form.querySelector('select[name="enabled"]');
    const status = form.querySelector('[role="status"]');
    const enabled = approvalInput.value === 'true';
    status.textContent = 'Saving…';
    status.classList.remove('error');
    submitButton.disabled = true;
    try {
      const response = await fetch(`/api/admin/users/${userId}/monthly-account`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to update monthly billing approval.');
      const user = directoryUsers.find((entry) => Number(entry.id) === userId);
      if (user) user.monthly_account_enabled = enabled;
      status.textContent = result.message;
    } catch (error) {
      status.textContent = error.message;
      status.classList.add('error');
    } finally {
      submitButton.disabled = false;
    }
    return;
  }

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
document.getElementById('close-total-orders-dialog').addEventListener('click', () => totalOrdersDialog.close());
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
totalOrdersDialog.addEventListener('click', (event) => {
  if (event.target === totalOrdersDialog) totalOrdersDialog.close();
});
totalOrdersList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-total-order-id]');
  if (!button) return;

  const selectedOrder = allOrders.find((order) => Number(order.id) === Number(button.dataset.totalOrderId));
  if (!selectedOrder) return;
  totalOrdersDialog.close();
  showOrderDetails(selectedOrder);
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

function formatStockQuantity(quantity) {
  return Number(quantity).toLocaleString(undefined, { maximumFractionDigits: 3 });
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
            <th scope="col">Monthly billing</th>
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
                <td>
                  ${user.role === 'staff' ? `
                    <form class="admin-user-monthly-form" data-user-id="${Number(user.id)}">
                      <label class="visually-hidden" for="monthly-account-${Number(user.id)}">Monthly billing approval for ${escapeHtml(user.full_name)}</label>
                      <select id="monthly-account-${Number(user.id)}" name="enabled">
                        <option value="false" ${user.monthly_account_enabled ? '' : 'selected'}>Not approved</option>
                        <option value="true" ${user.monthly_account_enabled ? 'selected' : ''}>Approved</option>
                      </select>
                      <button type="submit" class="admin-user-email-save">Save</button>
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
        ${data.weekdays.map((day, dayOfWeek) => `
          <th scope="col">
            <button type="button" class="schedule-day-toggle" data-toggle-day="${dayOfWeek}"
              title="Tick or untick ${escapeHtml(day)} for every meal shown">
              <span>${escapeHtml(day.slice(0, 3))}</span>
              <small class="schedule-day-count" data-day-count="${dayOfWeek}">0</small>
            </button>
          </th>
        `).join('')}
        <th scope="col">Plates available</th>
      </tr>
    `;

    if (!data.menuItems.length) {
      scheduleBody.innerHTML = '<tr><td colspan="9">No menu items are available to schedule.</td></tr>';
      scheduleSearchEmpty.hidden = true;
      saveScheduleButton.disabled = true;
      saveMenuStockButton.disabled = true;
      return;
    }

    const assignedMeals = new Set(data.schedule.map((entry) => `${entry.dayOfWeek}:${entry.menuItemId}`));
    scheduleBody.innerHTML = data.menuItems.map((item) => `
      <tr data-menu-item-row>
        <th scope="row">
          <span class="schedule-meal-name">${escapeHtml(item.name)}</span>
          <span class="schedule-meal-price">${formatCurrency(item.price)}</span>
        </th>
        ${data.weekdays.map((day, dayOfWeek) => {
          const checked = assignedMeals.has(`${dayOfWeek}:${item.id}`) ? ' checked' : '';
          return `
            <td class="schedule-cell">
              <label class="schedule-checkbox" aria-label="${escapeHtml(item.name)} served on ${escapeHtml(day)}">
                <input type="checkbox" data-menu-item-id="${Number(item.id)}" data-day-of-week="${dayOfWeek}"${checked}>
                <span class="visually-hidden">${escapeHtml(day)}</span>
              </label>
            </td>
          `;
        }).join('')}
        <td>
          <label class="visually-hidden" for="menu-stock-${Number(item.id)}">Plates available for ${escapeHtml(item.name)}</label>
          <input class="menu-stock-input" id="menu-stock-${Number(item.id)}" type="number" min="0" max="1000000" step="1" value="${Number(item.stock_quantity)}" data-menu-stock-id="${Number(item.id)}" required>
        </td>
      </tr>
    `).join('');
    filterMenuSchedule();
    updateScheduleDayCounts();
    setScheduleDirty(false);
    setMenuStockDirty(false);
    saveScheduleButton.disabled = false;
    saveMenuStockButton.disabled = false;
  } catch (error) {
    console.error('Error loading weekly menu schedule:', error);
    scheduleStatus.textContent = error.message;
    scheduleStatus.classList.add('error');
  }
}

function filterMenuSchedule() {
  const query = scheduleSearchInput.value.trim().toLocaleLowerCase();
  const rows = Array.from(scheduleBody.querySelectorAll('[data-menu-item-row]'));
  let visibleRows = 0;

  for (const row of rows) {
    const mealName = row.querySelector('.schedule-meal-name').textContent.toLocaleLowerCase();
    row.hidden = !mealName.includes(query);
    if (!row.hidden) visibleRows += 1;
  }

  scheduleSearchEmpty.hidden = !query || visibleRows > 0;
}

scheduleSearchInput.addEventListener('input', filterMenuSchedule);

// --- Weekly schedule: live day counts, day toggles and unsaved-change hints ---
function updateScheduleDayCounts() {
  scheduleHead.querySelectorAll('[data-day-count]').forEach((badge) => {
    const day = badge.dataset.dayCount;
    badge.textContent = String(scheduleBody.querySelectorAll(`input[data-day-of-week="${day}"]:checked`).length);
  });
}

function setScheduleDirty(isDirty) {
  saveScheduleButton.classList.toggle('has-changes', isDirty);
  if (isDirty) {
    scheduleStatus.textContent = 'You have unsaved schedule changes. Click “Save Weekly Schedule” to keep them.';
    scheduleStatus.classList.remove('error');
    scheduleStatus.classList.add('is-pending');
  } else {
    scheduleStatus.classList.remove('is-pending');
  }
}

function setMenuStockDirty(isDirty) {
  saveMenuStockButton.classList.toggle('has-changes', isDirty);
  if (isDirty) {
    menuPlateStatus.textContent = 'You have unsaved plate counts. Click “Save Plate Counts” to keep them.';
    menuPlateStatus.classList.remove('error');
    menuPlateStatus.classList.add('is-pending');
  } else {
    menuPlateStatus.classList.remove('is-pending');
  }
}

scheduleBody.addEventListener('change', (event) => {
  if (event.target.matches('input[type="checkbox"]')) {
    updateScheduleDayCounts();
    setScheduleDirty(true);
  }
});

scheduleBody.addEventListener('input', (event) => {
  if (event.target.matches('[data-menu-stock-id]')) setMenuStockDirty(true);
});

scheduleHead.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-toggle-day]');
  if (!toggle) return;
  const boxes = Array.from(scheduleBody.querySelectorAll(`input[data-day-of-week="${toggle.dataset.toggleDay}"]`))
    .filter((box) => !box.closest('tr').hidden);
  if (!boxes.length) return;
  const tickAll = boxes.some((box) => !box.checked);
  boxes.forEach((box) => { box.checked = tickAll; });
  updateScheduleDayCounts();
  setScheduleDirty(true);
});

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
    setScheduleDirty(false);
    scheduleStatus.textContent = result.message;
  } catch (error) {
    scheduleStatus.textContent = error.message;
    scheduleStatus.classList.add('error');
  } finally {
    saveScheduleButton.disabled = false;
  }
}

async function saveMenuStock() {
  const inputs = Array.from(scheduleBody.querySelectorAll('[data-menu-stock-id]'));
  if (inputs.some((input) => !input.reportValidity())) return;

  const stockQuantities = inputs.map((input) => ({
    menuItemId: Number(input.dataset.menuStockId),
    quantity: Number(input.value)
  }));

  saveMenuStockButton.disabled = true;
  menuPlateStatus.textContent = 'Saving plate counts…';
  menuPlateStatus.classList.remove('error');
  try {
    const response = await fetch('/api/admin/menu-stock', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stockQuantities })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to save plate counts.');
    setMenuStockDirty(false);
    menuPlateStatus.textContent = result.message;
  } catch (error) {
    menuPlateStatus.textContent = error.message;
    menuPlateStatus.classList.add('error');
  } finally {
    saveMenuStockButton.disabled = false;
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

const stockOnHand = document.getElementById('stock-onhand');
const stockCount = document.getElementById('stock-count');
const stockUnitSuffix = document.getElementById('stock-unit-suffix');
let inventoryLoadedOnce = false;

function setStockStatus(message, tone = 'info') {
  stockStatus.textContent = message;
  stockStatus.classList.toggle('error', tone === 'error');
  stockStatus.classList.toggle('is-success', tone === 'success');
}

function formatLedgerDate(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return `<span class="ledger-day">${date.toLocaleDateString(undefined, { weekday: 'short' })}</span>
    ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function formatLedgerChange(quantity, unit, sign) {
  const amount = Number(quantity);
  if (!amount) return '<span class="ledger-zero">—</span>';
  return `<span class="ledger-change ${sign === '-' ? 'is-used' : 'is-added'}">${sign === '-' ? '−' : '+'}${formatStockQuantity(amount)} ${escapeHtml(unit)}</span>`;
}

let inventoryItems = [];
const stockSearch = document.getElementById('stock-item-search');
const stockOptionsList = document.getElementById('stock-item-options');
const stockSearchClear = document.getElementById('stock-item-clear');
const stockFilterNote = document.getElementById('stock-filter-note');
let stockActiveIndex = -1;
let stockMatches = [];

function syncStockSelection() {
  const selectedOption = stockItemSelect.selectedOptions[0];
  const unit = selectedOption?.dataset.unit || 'kg';
  stockUnit.textContent = unit;
  stockUnitSuffix.textContent = unit;
  stockOnHand.querySelectorAll('.stock-item').forEach((card) => {
    card.setAttribute('aria-pressed', String(card.dataset.stockId === stockItemSelect.value));
  });
  // Show the chosen item's name in the search box (unless the admin is typing).
  const selectedItem = inventoryItems.find((item) => String(item.id) === stockItemSelect.value);
  if (selectedItem && document.activeElement !== stockSearch) stockSearch.value = selectedItem.name;
  stockSearchClear.hidden = !stockSearch.value;
  filterStockCards();
}

// --- Stock item search (combobox) ---
function getStockMatches(query) {
  const q = query.trim().toLowerCase();
  if (!q) return inventoryItems.slice();
  return inventoryItems
    .map((item) => {
      const name = String(item.name).toLowerCase();
      const index = name.indexOf(q);
      const wordStart = name.split(/[\s-]+/).some((word) => word.startsWith(q));
      return { item, rank: index === 0 ? 0 : wordStart ? 1 : index > 0 ? 2 : -1 };
    })
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || String(a.item.name).localeCompare(String(b.item.name)))
    .map((entry) => entry.item);
}

function highlightMatch(name, query) {
  const q = query.trim();
  const index = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (index < 0) return escapeHtml(name);
  return `${escapeHtml(name.slice(0, index))}<mark>${escapeHtml(name.slice(index, index + q.length))}</mark>${escapeHtml(name.slice(index + q.length))}`;
}

function setStockActive(index) {
  stockActiveIndex = index;
  const options = stockOptionsList.querySelectorAll('[role="option"]');
  options.forEach((option, i) => option.setAttribute('aria-selected', String(i === index)));
  const active = options[index];
  if (active) {
    stockSearch.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  } else {
    stockSearch.removeAttribute('aria-activedescendant');
  }
}

function openStockOptions() {
  const query = stockSearch.value;
  stockMatches = getStockMatches(query);
  stockOptionsList.innerHTML = stockMatches.length
    ? stockMatches.map((item, index) => {
        const quantity = Number(item.current_quantity) || 0;
        return `
          <li role="option" id="stock-option-${Number(item.id)}" data-stock-id="${Number(item.id)}" aria-selected="false"
            class="${quantity <= 0 ? 'is-empty' : ''}">
            <span class="combo-name">${highlightMatch(String(item.name), query)}</span>
            <span class="combo-qty">${formatStockQuantity(quantity)} ${escapeHtml(item.unit)}</span>
          </li>
        `;
      }).join('')
    : `<li class="combo-empty" role="presentation">No stock items match “${escapeHtml(query.trim())}”.</li>`;
  stockOptionsList.hidden = false;
  stockSearch.setAttribute('aria-expanded', 'true');
  setStockActive(stockMatches.length ? 0 : -1);
}

function closeStockOptions() {
  stockOptionsList.hidden = true;
  stockSearch.setAttribute('aria-expanded', 'false');
  setStockActive(-1);
}

function chooseStockItem(id) {
  stockItemSelect.value = String(id);
  const item = inventoryItems.find((entry) => String(entry.id) === String(id));
  if (item) stockSearch.value = item.name;
  closeStockOptions();
  syncStockSelection();
  stockQuantity.focus();
}

function filterStockCards() {
  const query = stockSearch.value.trim();
  const ids = new Set(getStockMatches(query).map((item) => String(item.id)));
  let shown = 0;
  stockOnHand.querySelectorAll('.stock-item').forEach((card) => {
    const visible = !query || ids.has(card.dataset.stockId);
    card.hidden = !visible;
    if (visible) shown += 1;
  });
  let empty = stockOnHand.querySelector('.stock-onhand-nomatch');
  if (query && shown === 0 && inventoryItems.length) {
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'stock-onhand-empty stock-onhand-nomatch';
      stockOnHand.appendChild(empty);
    }
    empty.textContent = `No stock items match “${query}”.`;
  } else if (empty) {
    empty.remove();
  }
  stockFilterNote.hidden = !query;
  stockFilterNote.textContent = query ? `· showing ${shown} of ${inventoryItems.length}` : '';
}

stockSearch.addEventListener('input', () => {
  // Typing starts a new search, so forget the previous choice until one is picked.
  stockItemSelect.value = '';
  syncStockSelection();
  openStockOptions();
});

stockSearch.addEventListener('focus', () => {
  if (!stockItemSelect.value) openStockOptions();
});

stockSearch.addEventListener('keydown', (event) => {
  const isOpen = !stockOptionsList.hidden;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (!isOpen) openStockOptions();
    else if (stockMatches.length) setStockActive((stockActiveIndex + 1) % stockMatches.length);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (isOpen && stockMatches.length) setStockActive((stockActiveIndex - 1 + stockMatches.length) % stockMatches.length);
  } else if (event.key === 'Enter') {
    if (isOpen && stockMatches[stockActiveIndex]) {
      event.preventDefault();
      chooseStockItem(stockMatches[stockActiveIndex].id);
    }
  } else if (event.key === 'Escape') {
    if (isOpen) {
      event.preventDefault();
      closeStockOptions();
    }
  }
});

stockSearch.addEventListener('blur', () => {
  // Let a click on an option land first, then tidy up.
  setTimeout(() => {
    if (stockOptionsList.contains(document.activeElement)) return;
    closeStockOptions();
    if (!stockItemSelect.value && stockSearch.value.trim()) {
      const exact = inventoryItems.find((item) => item.name.toLowerCase() === stockSearch.value.trim().toLowerCase());
      if (exact) {
        stockItemSelect.value = String(exact.id);
        syncStockSelection();
      }
    }
  }, 150);
});

// mousedown (not click) so the input keeps focus and blur does not close the list first.
stockOptionsList.addEventListener('mousedown', (event) => {
  const option = event.target.closest('[role="option"]');
  if (!option) return;
  event.preventDefault();
  chooseStockItem(option.dataset.stockId);
});

stockSearchClear.addEventListener('click', () => {
  stockSearch.value = '';
  stockItemSelect.value = '';
  syncStockSelection();
  stockSearch.focus();
});

// Block submitting without a chosen item (the real list is hidden, so the browser cannot flag it).
document.addEventListener('submit', (event) => {
  if (event.target !== stockReceiptForm || stockItemSelect.value) return;
  event.preventDefault();
  event.stopPropagation();
  setStockStatus(stockSearch.value.trim()
    ? `Choose a stock item from the list: nothing matches “${stockSearch.value.trim()}” exactly.`
    : 'Choose a stock item first. Start typing its name, for example “water”.', 'error');
  stockSearch.focus();
}, true);

stockReceiptForm.addEventListener('reset', () => {
  setTimeout(() => {
    stockSearchClear.hidden = true;
    filterStockCards();
  });
});

async function loadInventory() {
  if (!inventoryLoadedOnce) setStockStatus('Loading stock inventory…');
  try {
    const response = await fetch('/api/cashier/inventory');
    const result = await readStockApiResponse(response);
    if (!response.ok) throw new Error(result.message || 'Unable to load stock inventory.');

    inventoryItems = result.items;
    // Keep the admin's current choice when the list refreshes every few seconds.
    const previousSelection = stockItemSelect.value;
    stockItemSelect.innerHTML = result.items.length
      ? `<option value="">Choose a stock item</option>${result.items.map((item) => `
          <option value="${Number(item.id)}" data-unit="${escapeHtml(item.unit)}">${escapeHtml(item.name)} (${escapeHtml(item.unit)})</option>
        `).join('')}`
      : '<option value="">No stock items available</option>';
    if (previousSelection && result.items.some((item) => String(item.id) === previousSelection)) {
      stockItemSelect.value = previousSelection;
    }
    stockItemSelect.disabled = !result.items.length;
    stockSearch.disabled = !result.items.length;
    stockSearch.placeholder = result.items.length ? 'Type to search, e.g. water' : 'No stock items available';

    stockCount.hidden = !result.items.length;
    stockCount.textContent = `${result.items.length} item${result.items.length === 1 ? '' : 's'} tracked`;
    stockOnHand.innerHTML = result.items.length
      ? result.items.map((item) => {
          const quantity = Number(item.current_quantity) || 0;
          const isEmpty = quantity <= 0;
          return `
            <button type="button" class="stock-item${isEmpty ? ' is-empty' : ''}" data-stock-id="${Number(item.id)}" aria-pressed="false"
              aria-label="${escapeHtml(item.name)}: ${formatStockQuantity(quantity)} ${escapeHtml(item.unit)} on hand. Select to record a movement.">
              <span class="stock-item-name">${escapeHtml(item.name)}</span>
              <span class="stock-item-qty"><strong>${formatStockQuantity(quantity)}</strong> ${escapeHtml(item.unit)}</span>
              <span class="stock-item-state">${isEmpty ? 'Out of stock' : 'In stock'}</span>
            </button>
          `;
        }).join('')
      : '<div class="stock-onhand-empty">No stock items have been set up yet.</div>';

    stockLedgerBody.innerHTML = result.ledger.length
      ? result.ledger.map((entry) => `
          <tr>
            <td class="ledger-date">${formatLedgerDate(entry.date)}</td>
            <th scope="row">${escapeHtml(entry.item_name)}</th>
            <td>${formatStockQuantity(entry.opening)} ${escapeHtml(entry.unit)}</td>
            <td>${formatLedgerChange(entry.used, entry.unit, '-')}</td>
            <td>${formatLedgerChange(entry.added, entry.unit, '+')}</td>
            <td class="ledger-closing">${formatStockQuantity(entry.closing)} ${escapeHtml(entry.unit)}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="6" class="ledger-empty">No stock activity has been recorded yet.</td></tr>';
    syncStockSelection();
    if (!inventoryLoadedOnce) setStockStatus('');
    inventoryLoadedOnce = true;
  } catch (error) {
    setStockStatus(error.message, 'error');
    if (!inventoryLoadedOnce) {
      stockLedgerBody.innerHTML = '<tr><td colspan="6" class="ledger-empty">Unable to load the stock ledger.</td></tr>';
      stockOnHand.innerHTML = '<div class="stock-onhand-empty">Unable to load stock levels.</div>';
    }
  }
}

stockItemSelect.addEventListener('change', syncStockSelection);

stockOnHand.addEventListener('click', (event) => {
  const card = event.target.closest('.stock-item');
  if (!card) return;
  stockItemSelect.value = card.dataset.stockId;
  syncStockSelection();
  stockQuantity.focus();
});

stockReceiptForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const action = event.submitter?.value || 'received';
  if (!['received', 'used'].includes(action)) return;
  const isRemoval = action === 'used';
  const buttons = stockReceiptForm.querySelectorAll('button[type="submit"]');
  buttons.forEach((button) => { button.disabled = true; });
  setStockStatus(isRemoval ? 'Removing used stock…' : 'Recording received stock…');
  try {
    const response = await fetch(isRemoval ? '/api/cashier/stock-usage' : '/api/cashier/stock-receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inventoryItemId: stockItemSelect.value,
        quantity: stockQuantity.value
      })
    });
    const result = await readStockApiResponse(response);
    if (!response.ok) throw new Error(result.message || (isRemoval ? 'Unable to remove stock.' : 'Unable to record received stock.'));
    stockReceiptForm.reset();
    await loadInventory();
    setStockStatus(result.message, 'success');
  } catch (error) {
    setStockStatus(error.message, 'error');
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
});

// --- Student credit: search, select, deposit ---
const depositPreview = document.getElementById('deposit-preview');
const depositPreviewValue = document.getElementById('deposit-preview-value');

function setCashierStatus(message, tone = 'info') {
  cashierStatus.textContent = message;
  cashierStatus.classList.toggle('error', tone === 'error');
  cashierStatus.classList.toggle('is-success', tone === 'success');
  cashierStatus.classList.toggle('is-info', tone === 'info');
}

function getInitials(name) {
  return String(name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0].toUpperCase()).join('') || '?';
}

function updateDepositPreview() {
  const amount = Number(depositAmount.value);
  const valid = selectedStudent && Number.isFinite(amount) && amount > 0;
  depositPreview.hidden = !valid;
  if (valid) {
    depositPreviewValue.textContent = formatCredit(selectedStudent.balanceCents + Math.round(amount * 100));
  }
  depositForm.querySelectorAll('[data-quick-amount]').forEach((button) => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.quickAmount) === amount));
  });
}

function clearStudentSelection() {
  selectedStudent = null;
  depositForm.hidden = true;
  depositForm.reset();
  updateDepositPreview();
  searchResults.querySelectorAll('.student-result').forEach((button) => button.setAttribute('aria-pressed', 'false'));
}

searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearStudentSelection();
  setCashierStatus('Searching student accounts…');
  searchResults.innerHTML = '';

  try {
    const response = await fetch(`/api/cashier/students?search=${encodeURIComponent(searchInput.value.trim())}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to search student accounts.');
    const count = result.students.length;
    setCashierStatus(count
      ? `${count} account${count === 1 ? '' : 's'} found. Select the correct student. Check the username carefully.`
      : 'No matching student accounts. Try part of the name or the username.', count ? 'info' : 'error');
    searchResults.innerHTML = result.students.map((student) => `
      <button type="button" class="student-result" aria-pressed="false" data-username="${escapeHtml(student.username)}" data-name="${escapeHtml(student.fullName)}" data-balance="${Number(student.balanceCents)}">
        <span class="credit-avatar" aria-hidden="true">${escapeHtml(getInitials(student.fullName))}</span>
        <span class="student-result-who">
          <strong>${escapeHtml(student.fullName)}</strong>
          <span class="credit-username">@${escapeHtml(student.username)}</span>
        </span>
        <span class="student-result-balance">
          <small>Balance</small>
          <strong data-balance-label>${formatCredit(student.balanceCents)}</strong>
        </span>
        <span class="student-result-pick" aria-hidden="true"></span>
      </button>
    `).join('');
  } catch (error) {
    setCashierStatus(error.message, 'error');
  }
});

searchResults.addEventListener('click', (event) => {
  const button = event.target.closest('.student-result');
  if (!button) return;
  searchResults.querySelectorAll('.student-result').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  selectedStudent = {
    username: button.dataset.username,
    fullName: button.dataset.name,
    balanceCents: Number(button.dataset.balance) || 0
  };
  selectedStudentLabel.textContent = selectedStudent.fullName;
  document.getElementById('selected-student-username').textContent = `@${selectedStudent.username}`;
  document.getElementById('selected-student-avatar').textContent = getInitials(selectedStudent.fullName);
  document.getElementById('selected-student-balance').textContent = formatCredit(selectedStudent.balanceCents);
  depositAmount.value = '';
  depositForm.hidden = false;
  updateDepositPreview();
  setCashierStatus(`Confirm this is ${selectedStudent.fullName} (@${selectedStudent.username}) before recording cash.`);
  depositForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  depositAmount.focus({ preventScroll: true });
});

depositAmount.addEventListener('input', updateDepositPreview);

depositForm.addEventListener('click', (event) => {
  const quick = event.target.closest('[data-quick-amount]');
  if (quick) {
    depositAmount.value = Number(quick.dataset.quickAmount).toFixed(2);
    updateDepositPreview();
    depositAmount.focus();
    return;
  }
  if (event.target.closest('#deposit-cancel')) {
    clearStudentSelection();
    setCashierStatus('Select the correct student account.');
    searchResults.querySelector('.student-result')?.focus();
  }
});

depositForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedStudent) return;
  const submitButton = depositForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  setCashierStatus('Recording deposit…');

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
    // Refresh the balance shown on the student's result card.
    const card = Array.from(searchResults.querySelectorAll('.student-result'))
      .find((item) => item.dataset.username === selectedStudent.username);
    if (card && result.student) {
      card.dataset.balance = String(Number(result.student.balanceCents));
      card.querySelector('[data-balance-label]').textContent = formatCredit(result.student.balanceCents);
    }
    clearStudentSelection();
    setCashierStatus(`${result.message} New balance: ${formatCredit(result.student.balanceCents)}.`, 'success');
    await loadTransactions();
  } catch (error) {
    setCashierStatus(error.message, 'error');
  } finally {
    submitButton.disabled = false;
  }
});

function getOrderLocalDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTodayLocalDate() {
  return getOrderLocalDate(new Date());
}

function resetOrderFiltersForToday(today) {
  adminOrderDateInput.value = today;
  adminOrderSearchInput.value = '';
  adminOrderStatusSelect.value = '';
}

lastObservedOrderDate = getTodayLocalDate();
resetOrderFiltersForToday(lastObservedOrderDate);

function renderOrders() {
  const today = getTodayLocalDate();
  if (today !== lastObservedOrderDate) {
    lastObservedOrderDate = today;
    resetOrderFiltersForToday(today);
  }
  if (!adminOrderDateInput.value) {
    adminOrderDateInput.value = today;
  }

  const customerSearch = adminOrderSearchInput.value.trim().toLocaleLowerCase();
  const selectedDate = adminOrderDateInput.value;
  const selectedStatus = adminOrderStatusSelect.value;
  const dateOrders = allOrders.filter((order) =>
    !selectedDate || getOrderLocalDate(order.created_at) === selectedDate
  );
  const filteredOrders = dateOrders.filter((order) => {
    const matchesCustomer = !customerSearch ||
      `${order.customer_name} ${order.phone}`.toLocaleLowerCase().includes(customerSearch);
    const matchesStatus = !selectedStatus || order.status === selectedStatus;
    return matchesCustomer && matchesStatus;
  });

  adminOrderResultsMessage.textContent = dateOrders.length
    ? `Showing ${filteredOrders.length} of ${dateOrders.length} orders for ${selectedDate}.`
    : '';

  if (!filteredOrders.length) {
    ordersContainer.innerHTML = allOrders.length
      ? '<div class="empty-state">No orders for this date match the selected filters. Choose another date or clear the filters.</div>'
      : '<div class="empty-state">No orders yet. New customer orders will appear here.</div>';
    return;
  }

  ordersContainer.innerHTML = filteredOrders.map(order => `
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
      const order = filteredOrders.find((entry) => Number(entry.id) === Number(button.dataset.orderId));
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
      <div><span>Payment</span><strong>${order.payment_method === 'monthly' ? 'Monthly account' : order.payment_method === 'credit' ? 'Student credit' : 'Cash'}</strong></div>
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
    if (!response.ok) throw new Error(orders.message || 'Unable to load orders.');
    allOrders = orders;
    downloadOrderHistoryButton.disabled = allOrders.length === 0;
    adminOrderResultsMessage.classList.remove('error');
    renderOrders();
  } catch (error) {
    console.error('Error loading orders:', error);
    adminOrderResultsMessage.textContent = error.message;
    adminOrderResultsMessage.classList.add('error');
  }
}

adminOrderSearchInput.addEventListener('input', renderOrders);
adminOrderDateInput.addEventListener('change', renderOrders);
adminOrderStatusSelect.addEventListener('change', renderOrders);
clearAdminOrderFiltersButton.addEventListener('click', () => {
  adminOrderSearchInput.value = '';
  adminOrderDateInput.value = getTodayLocalDate();
  adminOrderStatusSelect.value = '';
  renderOrders();
  adminOrderSearchInput.focus();
});

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

downloadOrderHistoryButton.addEventListener('click', () => {
  if (!allOrders.length) return;

  const rows = [[
    'Order ID', 'Customer', 'Phone', 'Address', 'Note', 'Date', 'Status',
    'Payment method', 'Item', 'Quantity', 'Unit price', 'Line total', 'Order total'
  ]];

  allOrders.forEach((order) => {
    const items = Array.isArray(order.items) && order.items.length ? order.items : [null];
    items.forEach((item) => {
      rows.push([
        order.id,
        order.customer_name,
        order.phone,
        order.address,
        order.note,
        new Date(order.created_at).toLocaleString(),
        order.status,
        order.payment_method === 'credit' ? 'Student credit' : 'Cash',
        item ? item.item_name : '',
        item ? item.quantity : '',
        item ? Number(item.unit_price).toFixed(2) : '',
        item ? (Number(item.unit_price) * Number(item.quantity)).toFixed(2) : '',
        Number(order.total).toFixed(2)
      ].map(csvCell));
    });
  });

  const csv = `\uFEFF${rows.map((row) => row.join(',')).join('\r\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = `order-history-${getTodayLocalDate()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
});

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
      const showTotalOrders = async () => {
        totalOrdersStatus.textContent = 'Loading orders…';
        totalOrdersStatus.classList.remove('error');
        totalOrdersList.innerHTML = '';
        totalOrdersDialog.showModal();

        try {
          const response = await fetch('/api/orders');
          const orders = await response.json();
          if (!response.ok) throw new Error(orders.message || 'Unable to load orders.');

          allOrders = orders;
          totalOrdersStatus.textContent = `${orders.length} order${orders.length === 1 ? '' : 's'}. Select an order to view its details.`;
          totalOrdersList.innerHTML = orders.length ? orders.map((order) => `
            <button type="button" class="order-card admin-order-summary" data-total-order-id="${Number(order.id)}">
              <span class="admin-order-summary-main">
                <span class="admin-order-number">Order #${Number(order.id)}</span>
                <span class="admin-order-customer">${escapeHtml(order.customer_name)}</span>
              </span>
              <span class="admin-order-summary-end">
                <span class="badge">${escapeHtml(order.status)}</span>
                <strong>${formatCurrency(order.total)}</strong>
              </span>
            </button>
          `).join('') : '<div class="empty-state">No orders yet.</div>';
        } catch (error) {
          totalOrdersStatus.textContent = error.message || 'Unable to load orders.';
          totalOrdersStatus.classList.add('error');
        }
      };

      totalOrdersCard.addEventListener('click', showTotalOrders);
      totalOrdersCard.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          showTotalOrders();
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

// --- Client feedback: filter tabs, one-click status, stable refreshes ---
const FEEDBACK_STATUSES = [
  { key: 'new', label: 'New' },
  { key: 'reviewing', label: 'Reviewing' },
  { key: 'resolved', label: 'Resolved' }
];
const FEEDBACK_CATEGORIES = {
  food: { label: 'Food', icon: '<path d="M4 3v8a3 3 0 0 0 3 3v7M7 3v6M10 3v8a3 3 0 0 1-3 3"/><path d="M17 21V3c-2.2 1.2-3.5 3.6-3.5 7v4H17"/>' },
  order: { label: 'Order', icon: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6"/>' },
  service: { label: 'Service', icon: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>' },
  website: { label: 'Website', icon: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>' },
  other: { label: 'Other', icon: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>' }
};
let feedbackEntries = [];
let feedbackFilter = 'all';
let feedbackSignature = '';

function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return formatter.format(-Math.round(seconds / size), unit);
  }
  return 'just now';
}

function renderClientFeedback(feedback) {
  feedbackEntries = feedback;
  if (!feedback.length) {
    clientFeedbackList.innerHTML = '<div class="empty-state">No client feedback has been submitted yet.</div>';
    return;
  }

  const counts = { all: feedback.length };
  FEEDBACK_STATUSES.forEach(({ key }) => { counts[key] = feedback.filter((entry) => entry.status === key).length; });
  const visible = feedbackFilter === 'all' ? feedback : feedback.filter((entry) => entry.status === feedbackFilter);

  clientFeedbackList.innerHTML = `
    <div class="feedback-tabs" role="tablist" aria-label="Filter feedback by status">
      ${[{ key: 'all', label: 'All' }, ...FEEDBACK_STATUSES].map(({ key, label }) => `
        <button type="button" role="tab" class="feedback-tab" data-feedback-filter="${key}" data-tone="${key}"
          aria-selected="${feedbackFilter === key}">
          ${label} <span>${counts[key]}</span>
        </button>
      `).join('')}
    </div>
    ${visible.length ? `
      <div class="feedback-grid">
        ${visible.map((entry) => {
          const category = FEEDBACK_CATEGORIES[entry.category] || { label: entry.category, icon: FEEDBACK_CATEGORIES.other.icon };
          const id = Number(entry.id);
          return `
            <article class="feedback-card" data-status="${escapeHtml(entry.status)}">
              <header class="feedback-card-head">
                <span class="credit-avatar" aria-hidden="true">${escapeHtml(getInitials(entry.full_name))}</span>
                <div class="feedback-card-who">
                  <strong>${escapeHtml(entry.full_name)}</strong>
                  <span class="credit-username">@${escapeHtml(entry.username)}</span>
                </div>
                <span class="feedback-category">
                  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${category.icon}</svg>
                  ${escapeHtml(category.label)}
                </span>
              </header>
              <div class="feedback-card-body${entry.has_photo ? ' has-photo' : ''}">
                <blockquote class="feedback-quote">${escapeHtml(entry.message)}</blockquote>
                ${entry.has_photo ? `
                  <a class="feedback-photo" href="/api/admin/feedback/${id}/photo" target="_blank" rel="noopener noreferrer"
                    title="Open the full photo in a new tab">
                    <img src="/api/admin/feedback/${id}/photo" alt="Photo attached to ${escapeHtml(category.label)} feedback from ${escapeHtml(entry.full_name)}" loading="lazy" />
                    <span>
                      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
                      Open
                    </span>
                  </a>
                ` : ''}
              </div>
              <footer class="feedback-card-foot">
                <time datetime="${escapeHtml(entry.created_at)}" title="${escapeHtml(formatSaleDate(entry.created_at))}">
                  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                  ${escapeHtml(formatRelativeTime(entry.created_at))}
                </time>
                <form class="client-feedback-status-form feedback-status" data-feedback-id="${id}" aria-label="Review status for feedback from ${escapeHtml(entry.full_name)}">
                  ${FEEDBACK_STATUSES.map(({ key, label }) => `
                    <button type="submit" name="status" value="${key}" data-tone="${key}" aria-pressed="${entry.status === key}">${label}</button>
                  `).join('')}
                </form>
              </footer>
            </article>
          `;
        }).join('')}
      </div>
    ` : `<div class="empty-state">No ${escapeHtml(feedbackFilter)} feedback right now.</div>`}
  `;
}

async function loadClientFeedback({ force = false } = {}) {
  try {
    const response = await fetch('/api/admin/feedback');
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to load client feedback.');
    const entries = Array.isArray(result) ? result : [];
    // Only rebuild when something changed, so photos and focus are not reset every 15 seconds.
    const signature = JSON.stringify(entries.map((entry) => [entry.id, entry.status, entry.has_photo]));
    if (force || signature !== feedbackSignature) {
      feedbackSignature = signature;
      renderClientFeedback(entries);
    }
    if (clientFeedbackStatus.classList.contains('error')) {
      clientFeedbackStatus.textContent = '';
      clientFeedbackStatus.classList.remove('error');
    }
  } catch (error) {
    clientFeedbackStatus.textContent = error.message;
    clientFeedbackStatus.classList.add('error');
  }
}

clientFeedbackList.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-feedback-filter]');
  if (!tab) return;
  feedbackFilter = tab.dataset.feedbackFilter;
  renderClientFeedback(feedbackEntries);
  clientFeedbackList.querySelector(`[data-feedback-filter="${feedbackFilter}"]`)?.focus();
});

clientFeedbackList.addEventListener('submit', async (event) => {
  const form = event.target.closest('.client-feedback-status-form');
  if (!form) return;
  event.preventDefault();
  const status = event.submitter?.value;
  if (!status || event.submitter.getAttribute('aria-pressed') === 'true') return;
  const buttons = form.querySelectorAll('button');
  buttons.forEach((button) => { button.disabled = true; });
  clientFeedbackStatus.classList.remove('error', 'is-success');
  clientFeedbackStatus.textContent = 'Updating feedback status…';
  try {
    const response = await fetch(`/api/admin/feedback/${Number(form.dataset.feedbackId)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to update feedback status.');
    await loadClientFeedback({ force: true });
    clientFeedbackStatus.textContent = result.message;
    clientFeedbackStatus.classList.add('is-success');
  } catch (error) {
    clientFeedbackStatus.textContent = error.message;
    clientFeedbackStatus.classList.add('error');
    buttons.forEach((button) => { button.disabled = false; });
  }
});

function getPreviousBillingPeriod() {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

monthlyBillingPeriodInput.value = getPreviousBillingPeriod();

function renderMonthlyInvoices(invoices) {
  if (!invoices.length) {
    monthlyInvoicesContainer.innerHTML = '<div class="empty-state">No monthly statements have been generated for this month.</div>';
    return;
  }

  monthlyInvoicesContainer.innerHTML = invoices.map((invoice) => `
    <article class="order-card monthly-invoice-card">
      <div class="monthly-invoice-heading">
        <div>
          <strong>Statement #${Number(invoice.id)} · ${escapeHtml(invoice.full_name)}</strong>
          <span>@${escapeHtml(invoice.username)} · ${escapeHtml(invoice.billing_period)}</span>
        </div>
        <span class="monthly-invoice-status ${invoice.status === 'paid' ? 'paid' : ''}">${escapeHtml(invoice.status)}</span>
      </div>
      <div class="monthly-invoice-total">
        <span>${invoice.orders.length} completed order${invoice.orders.length === 1 ? '' : 's'} · ${invoice.status === 'paid' ? `Paid ${escapeHtml(formatSaleDate(invoice.paid_at))}` : 'Payment due'}</span>
        <strong>${formatCredit(invoice.total_cents)}</strong>
      </div>
      <details class="monthly-invoice-orders">
        <summary>View included orders</summary>
        ${invoice.orders.map((order) => `
          <div class="monthly-invoice-order">
            <span>Order #${Number(order.order_id)} · ${escapeHtml(formatSaleDate(order.created_at))} · ${escapeHtml(order.status)}</span>
            <strong>${formatCurrency(order.total)}</strong>
          </div>
        `).join('')}
      </details>
      ${invoice.status === 'unpaid' ? `
        <button type="button" class="submit-btn monthly-invoice-pay" data-pay-invoice="${Number(invoice.id)}">
          Mark as paid
        </button>
      ` : ''}
    </article>
  `).join('');
}

async function loadMonthlyInvoices({ preserveStatus = false } = {}) {
  const period = monthlyBillingPeriodInput.value;
  if (!period) return;
  if (!preserveStatus) {
    monthlyBillingStatus.textContent = 'Loading monthly statements…';
    monthlyBillingStatus.classList.remove('error');
  }
  try {
    const response = await fetch(`/api/admin/monthly-invoices?period=${encodeURIComponent(period)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to load monthly statements.');
    renderMonthlyInvoices(result.invoices);
    if (!preserveStatus) monthlyBillingStatus.textContent = '';
  } catch (error) {
    monthlyBillingStatus.textContent = error.message;
    monthlyBillingStatus.classList.add('error');
  }
}

generateMonthlyInvoicesButton.addEventListener('click', async () => {
  generateMonthlyInvoicesButton.disabled = true;
  monthlyBillingStatus.textContent = 'Generating monthly statements…';
  monthlyBillingStatus.classList.remove('error');
  try {
    const response = await fetch('/api/admin/monthly-invoices/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period: monthlyBillingPeriodInput.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to generate monthly statements.');
    monthlyBillingStatus.textContent = result.message;
    await loadMonthlyInvoices({ preserveStatus: true });
  } catch (error) {
    monthlyBillingStatus.textContent = error.message;
    monthlyBillingStatus.classList.add('error');
  } finally {
    generateMonthlyInvoicesButton.disabled = false;
  }
});

monthlyBillingPeriodInput.addEventListener('change', loadMonthlyInvoices);

monthlyInvoicesContainer.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-pay-invoice]');
  if (!button) return;
  button.disabled = true;
  monthlyBillingStatus.textContent = 'Recording statement payment…';
  monthlyBillingStatus.classList.remove('error');
  try {
    const response = await fetch(`/api/admin/monthly-invoices/${Number(button.dataset.payInvoice)}/pay`, {
      method: 'PATCH'
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to record statement payment.');
    monthlyBillingStatus.textContent = result.message;
    await loadMonthlyInvoices({ preserveStatus: true });
  } catch (error) {
    monthlyBillingStatus.textContent = error.message;
    monthlyBillingStatus.classList.add('error');
    button.disabled = false;
  }
});

loadOrders();
loadSummary();
loadClientFeedback();
loadMenuSchedule();
loadInventory();
loadTransactions();
loadMonthlyInvoices();
saveScheduleButton.addEventListener('click', saveMenuSchedule);
saveMenuStockButton.addEventListener('click', saveMenuStock);
setInterval(loadOrders, 8000);
setInterval(loadSummary, 8000);
setInterval(loadClientFeedback, 15000);
setInterval(loadMonthlyInvoices, 15000);
setInterval(loadInventory, 12000);
setInterval(loadTransactions, 12000);
