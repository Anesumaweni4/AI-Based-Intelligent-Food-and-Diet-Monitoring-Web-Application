const searchForm = document.getElementById('student-search-form');
const searchInput = document.getElementById('student-search');
const searchResults = document.getElementById('student-search-results');
const depositForm = document.getElementById('deposit-form');
const selectedStudentLabel = document.getElementById('selected-student');
const depositAmount = document.getElementById('deposit-amount');
const cashierStatus = document.getElementById('cashier-status');
const transactionsContainer = document.getElementById('credit-transactions');
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

async function loadTransactions() {
  try {
    const response = await fetch('/api/cashier/transactions');
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to load credit activity.');
    transactionsContainer.innerHTML = result.transactions.length
      ? result.transactions.map((entry) => `
          <article class="order-card">
            <div class="order-header">
              <div>
                <h4>${escapeHtml(entry.student_name)} (@${escapeHtml(entry.student_username)})</h4>
                <div class="order-meta"><span>${escapeHtml(entry.type)}</span><span>${escapeHtml(entry.recorded_by || 'System')}</span></div>
              </div>
              <strong class="${Number(entry.amount_cents) < 0 ? 'credit-debit' : 'credit-addition'}">${formatCurrency(entry.amount_cents)}</strong>
            </div>
            <div class="order-meta"><span>${new Date(entry.created_at).toLocaleString()}</span></div>
          </article>
        `).join('')
      : '<div class="empty-state">No credit activity has been recorded yet.</div>';
  } catch (error) {
    transactionsContainer.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

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
    window.location.href = 'cashier-login.html';
  } catch (error) {
    cashierStatus.textContent = error.message;
    cashierStatus.classList.add('error');
  }
});

loadTransactions();
