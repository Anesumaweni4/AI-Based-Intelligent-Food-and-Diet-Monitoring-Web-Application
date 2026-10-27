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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function formatCurrency(cents) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

async function readApiResponse(response) {
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
                <strong>${formatCurrency(account.balance_cents)}</strong>
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
                      <strong class="${Number(entry.amount_cents) < 0 ? 'credit-debit' : 'credit-addition'}">${formatCurrency(entry.amount_cents)}</strong>
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
    const result = await readApiResponse(response);
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
    const result = await readApiResponse(response);
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
        <span>Balance: ${formatCurrency(student.balanceCents)}</span>
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
    cashierStatus.textContent = `${result.message} New balance: ${formatCurrency(result.student.balanceCents)}.`;
    depositForm.hidden = true;
    selectedStudent = null;
    await loadTransactions();
    searchForm.requestSubmit();
  } catch (error) {
    cashierStatus.textContent = error.message;
    cashierStatus.classList.add('error');
  } finally {
    submitButton.disabled = false;
  }
});

document.getElementById('cashier-logout').addEventListener('click', async (event) => {
  event.preventDefault();
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to log out.');
    localStorage.removeItem('foodieUser');
    window.location.href = 'login.html';
  } catch (error) {
    cashierStatus.textContent = error.message;
    cashierStatus.classList.add('error');
  }
});

loadTransactions();
loadInventory();
