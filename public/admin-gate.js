const adminGateDialog = document.createElement('dialog');
adminGateDialog.className = 'notice-dialog';
adminGateDialog.setAttribute('aria-labelledby', 'admin-gate-title');
adminGateDialog.innerHTML = `
  <form class="notice-dialog-content admin-gate-form" id="admin-gate-form">
    <p class="eyebrow">Restricted access</p>
    <h2 id="admin-gate-title">Admin access check</h2>
    <p>Enter the admin access details to continue to the administrator login.</p>
    <div class="field-group">
      <label for="admin-gate-username">Access username</label>
      <input id="admin-gate-username" name="username" type="text" autocomplete="username" required>
    </div>
    <div class="field-group">
      <label for="admin-gate-password">Access password</label>
      <input id="admin-gate-password" name="password" type="password" autocomplete="current-password" required>
    </div>
    <p class="schedule-status" id="admin-gate-status" role="status"></p>
    <div class="admin-gate-actions">
      <button class="submit-btn" type="submit">Continue to Admin Login</button>
      <button class="admin-gate-cancel" type="button">Cancel</button>
    </div>
  </form>
`;
document.body.appendChild(adminGateDialog);

const adminGateForm = document.getElementById('admin-gate-form');
const adminGateStatus = document.getElementById('admin-gate-status');
let adminGateDestination = '/admin-login.html';

document.querySelectorAll('a[href="admin-login.html"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    adminGateDestination = link.getAttribute('href');
    adminGateForm.reset();
    adminGateStatus.textContent = '';
    adminGateStatus.classList.remove('error');
    adminGateDialog.showModal();
    document.getElementById('admin-gate-username').focus();
  });
});

adminGateDialog.querySelector('.admin-gate-cancel').addEventListener('click', () => {
  adminGateDialog.close();
});

adminGateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = adminGateForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  adminGateStatus.textContent = 'Checking access…';
  adminGateStatus.classList.remove('error');

  try {
    const response = await fetch('/api/admin/gate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('admin-gate-username').value,
        password: document.getElementById('admin-gate-password').value
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to verify admin access.');
    window.location.href = adminGateDestination;
  } catch (error) {
    adminGateStatus.textContent = error.message;
    adminGateStatus.classList.add('error');
  } finally {
    submitButton.disabled = false;
  }
});
