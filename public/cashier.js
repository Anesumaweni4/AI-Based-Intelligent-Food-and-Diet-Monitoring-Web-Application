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

function formatStockQuantity(quantity) {
  return Number(quantity).toLocaleString(undefined, { maximumFractionDigits: 3 });
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

    stockItemSelect.innerHTML = result.items.length
      ? `<option value="">Choose a stock item</option>${result.items.map((item) => `
          <option value="${Number(item.id)}" data-unit="${escapeHtml(item.unit)}">${escapeHtml(item.name)} (${escapeHtml(item.unit)})</option>
        `).join('')}`
      : '<option value="">No stock items available</option>';
    stockItemSelect.disabled = !result.items.length;
    stockLedgerBody.innerHTML = result.ledger.length
      ? result.ledger.map((entry) => `
          <tr>
            <td>${escapeHtml(entry.date)}</td>
            <th scope="row">${escapeHtml(entry.item_name)}</th>
            <td>${formatStockQuantity(entry.opening)} ${escapeHtml(entry.unit)}</td>
            <td>${formatStockQuantity(entry.used)} ${escapeHtml(entry.unit)}</td>
            <td>${formatStockQuantity(entry.added)} ${escapeHtml(entry.unit)}</td>
            <td>${formatStockQuantity(entry.closing)} ${escapeHtml(entry.unit)}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="6">No stock activity has been recorded yet.</td></tr>';
    stockStatus.textContent = '';
  } catch (error) {
    stockStatus.textContent = error.message;
    stockStatus.classList.add('error');
    stockLedgerBody.innerHTML = '<tr><td colspan="6">Unable to load the stock ledger.</td></tr>';
  }
}

stockItemSelect.addEventListener('change', () => {
  const selectedOption = stockItemSelect.selectedOptions[0];
  stockUnit.textContent = selectedOption?.dataset.unit || 'kg';
});

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
        inventoryItemId: stockItemSelect.value,
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
setInterval(loadInventory, 12000);
