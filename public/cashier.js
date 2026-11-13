// Cashier desk: stock control, student credit and wallet balances.
// The stock, credit and wallet code below is generated from admin.js so both
// dashboards behave the same; page navigation lives in admin-shell.js.
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

function formatCurrency(value) {
  return `$${Number(value).toFixed(2)}`;
}

function formatCredit(cents) {
  return formatCurrency(Number(cents) / 100);
}

function formatStockQuantity(quantity) {
  return Number(quantity).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

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

// --- Wallet balances: totals, search, sort, history that survives refreshes ---
const walletStats = document.getElementById('wallet-stats');
const walletSearch = document.getElementById('wallet-search');
const walletSort = document.getElementById('wallet-sort');
const openWalletHistories = new Set();
let walletAccounts = [];
let walletSignature = '';

const WALLET_TYPES = {
  deposit: { label: 'Deposit', tone: 'deposit', icon: '<path d="M12 5v14M5 12h14"/>' },
  purchase: { label: 'Purchase', tone: 'purchase', icon: '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>' },
  refund: { label: 'Refund', tone: 'refund', icon: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>' }
};

function walletType(type) {
  return WALLET_TYPES[type] || { label: String(type || 'Adjustment'), tone: 'other', icon: '<circle cx="12" cy="12" r="3"/>' };
}

function renderWalletAccounts() {
  if (!walletAccounts.length) {
    walletStats.innerHTML = '';
    transactionsContainer.innerHTML = '<div class="empty-state">No student accounts yet.</div>';
    return;
  }

  const totalCents = walletAccounts.reduce((sum, account) => sum + Number(account.balance_cents || 0), 0);
  const withCredit = walletAccounts.filter((account) => Number(account.balance_cents) > 0).length;
  walletStats.innerHTML = `
    <div class="wallet-stat wallet-stat--main"><span>Total credit held</span><strong>${formatCredit(totalCents)}</strong></div>
    <div class="wallet-stat"><span>Students with credit</span><strong>${withCredit}</strong></div>
    <div class="wallet-stat"><span>Student accounts</span><strong>${walletAccounts.length}</strong></div>
  `;

  const query = walletSearch.value.trim().toLowerCase();
  const lastActivity = (account) => new Date(account.transactions[0]?.created_at || 0).getTime();
  const sorters = {
    balance: (a, b) => Number(b.balance_cents) - Number(a.balance_cents) || a.student_name.localeCompare(b.student_name),
    activity: (a, b) => lastActivity(b) - lastActivity(a) || a.student_name.localeCompare(b.student_name),
    name: (a, b) => a.student_name.localeCompare(b.student_name)
  };
  const visible = walletAccounts
    .filter((account) => !query
      || account.student_name.toLowerCase().includes(query)
      || account.student_username.toLowerCase().includes(query))
    .sort(sorters[walletSort.value] || sorters.balance);

  if (!visible.length) {
    transactionsContainer.innerHTML = `<div class="empty-state">No student accounts match “${escapeHtml(walletSearch.value.trim())}”.</div>`;
    return;
  }

  transactionsContainer.innerHTML = visible.map((account) => {
    const username = String(account.student_username);
    const balance = Number(account.balance_cents) || 0;
    const latest = account.transactions[0];
    const isOpen = openWalletHistories.has(username);
    const historyId = `wallet-history-${username.replace(/[^a-z0-9_-]/gi, '_')}`;
    return `
      <article class="wallet-row${balance <= 0 ? ' is-zero' : ''}">
        <div class="wallet-row-main">
          <span class="credit-avatar" aria-hidden="true">${escapeHtml(getInitials(account.student_name))}</span>
          <div class="wallet-row-who">
            <strong>${escapeHtml(account.student_name)}</strong>
            <span class="credit-username">@${escapeHtml(username)}</span>
          </div>
          <div class="wallet-row-last">
            ${latest ? `
              <span class="wallet-dot" data-tone="${walletType(latest.type).tone}" aria-hidden="true"></span>
              ${escapeHtml(walletType(latest.type).label)} · <time datetime="${escapeHtml(latest.created_at)}" title="${escapeHtml(new Date(latest.created_at).toLocaleString())}">${escapeHtml(formatRelativeTime(latest.created_at))}</time>
            ` : '<span class="wallet-none">No transactions yet</span>'}
          </div>
          <div class="wallet-row-balance">
            <small>Balance</small>
            <strong>${formatCredit(balance)}</strong>
          </div>
          ${account.transactions.length ? `
            <button type="button" class="wallet-history-toggle" data-wallet-toggle="${escapeHtml(username)}"
              aria-expanded="${isOpen}" aria-controls="${historyId}">
              History <span>${account.transactions.length}</span>
            </button>
          ` : '<span class="wallet-history-toggle is-placeholder" aria-hidden="true"></span>'}
        </div>
        ${account.transactions.length ? `
          <ol class="wallet-history" id="${historyId}" ${isOpen ? '' : 'hidden'}>
            ${account.transactions.map((entry) => {
              const type = walletType(entry.type);
              const amount = Number(entry.amount_cents) || 0;
              return `
                <li class="wallet-entry">
                  <span class="wallet-entry-icon" data-tone="${type.tone}" aria-hidden="true">
                    <svg class="icon" viewBox="0 0 24 24">${type.icon}</svg>
                  </span>
                  <div class="wallet-entry-text">
                    <strong>${escapeHtml(type.label)}</strong>
                    <span>${escapeHtml(entry.recorded_by || 'System')} · <time datetime="${escapeHtml(entry.created_at)}" title="${escapeHtml(new Date(entry.created_at).toLocaleString())}">${escapeHtml(formatRelativeTime(entry.created_at))}</time></span>
                  </div>
                  <strong class="wallet-entry-amount ${amount < 0 ? 'is-minus' : 'is-plus'}">${amount > 0 ? '+' : amount < 0 ? '−' : ''}${formatCredit(Math.abs(amount))}</strong>
                </li>
              `;
            }).join('')}
          </ol>
        ` : ''}
      </article>
    `;
  }).join('');
}

async function loadTransactions() {
  try {
    const response = await fetch('/api/cashier/transactions');
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to load credit activity.');
    const accounts = Array.isArray(result.accounts) ? result.accounts : [];
    // Only rebuild when balances or transactions changed (keeps open histories and focus).
    const signature = JSON.stringify(accounts.map((account) => [
      account.student_username, account.balance_cents, account.transactions.map((entry) => entry.id)
    ]));
    if (signature !== walletSignature) {
      walletSignature = signature;
      walletAccounts = accounts;
      renderWalletAccounts();
    }
  } catch (error) {
    if (!walletAccounts.length) {
      transactionsContainer.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }
}

walletSearch.addEventListener('input', renderWalletAccounts);
walletSort.addEventListener('change', renderWalletAccounts);

transactionsContainer.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-wallet-toggle]');
  if (!toggle) return;
  const username = toggle.dataset.walletToggle;
  const history = document.getElementById(toggle.getAttribute('aria-controls'));
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  if (history) history.hidden = !open;
  if (open) openWalletHistories.add(username);
  else openWalletHistories.delete(username);
});

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


// --- Cashier overview: quick figures from the data loaded above ---
function updateCashierOverview() {
  const totalCents = walletAccounts.reduce((sum, account) => sum + Number(account.balance_cents || 0), 0);
  const withCredit = walletAccounts.filter((account) => Number(account.balance_cents) > 0).length;
  const outOfStock = inventoryItems.filter((item) => Number(item.current_quantity) <= 0).length;
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  set('cashier-total-credit', walletAccounts.length ? formatCredit(totalCents) : '—');
  set('cashier-with-credit', walletAccounts.length ? String(withCredit) : '—');
  set('cashier-items', inventoryItems.length ? String(inventoryItems.length) : '—');
  set('cashier-out-of-stock', inventoryItems.length ? String(outOfStock) : '—');
}

loadTransactions().then(updateCashierOverview);
loadInventory().then(updateCashierOverview);
setInterval(() => loadInventory().then(updateCashierOverview), 12000);
setInterval(() => loadTransactions().then(updateCashierOverview), 15000);
