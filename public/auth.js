const userLoginForm = document.getElementById('login-form');
const adminLoginForm = document.getElementById('admin-login-form');
const cashierLoginForm = document.getElementById('cashier-login-form');
const registerForm = document.getElementById('register-form');
const passwordResetRequestForm = document.getElementById('password-reset-request-form');
const passwordResetCompleteForm = document.getElementById('password-reset-complete-form');
const toast = document.getElementById('toast');

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => toast.classList.remove('show'), 2600);
}

async function readApiResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('The app returned a webpage instead of an API response. Open the app at http://localhost:3000/login.html, not through VS Code Live Server or a file link.');
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`The app returned invalid data (HTTP ${response.status}). Please restart the app and try again.`);
  }
}

function completeLogin(result) {
  localStorage.setItem('foodieUser', JSON.stringify(result.user));
  showToast('Login successful');

  if (result.user.role === 'admin') {
    window.location.href = 'admin.html';
  } else if (result.user.role === 'cashier') {
    window.location.href = 'cashier.html';
  } else {
    window.location.href = 'home.html';
  }
}

const loginForms = [userLoginForm, adminLoginForm, cashierLoginForm].filter(Boolean);
loginForms.forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const requestedRole = form.id === 'admin-login-form' ? 'admin' : form.id === 'cashier-login-form' ? 'cashier' : 'auto';
    const payload = {
      username: form.querySelector('input[type="text"]').value.trim(),
      password: form.querySelector('input[type="password"]').value,
      role: requestedRole
    };

    try {
      const submitLogin = async () => {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        return { response, result: await readApiResponse(response) };
      };
      const { response, result } = await submitLogin();
      if (!response.ok) throw new Error(result.message || 'Login failed');

      completeLogin(result);
    } catch (error) {
      showToast(error.message);
    }
  });
});

if (registerForm) {
  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      fullName: document.getElementById('registerName').value.trim(),
      username: document.getElementById('registerUsername').value.trim(),
      email: document.getElementById('registerEmail').value.trim(),
      age: Number(document.getElementById('registerAge').value),
      weight: Number(document.getElementById('registerWeight').value),
      height: Number(document.getElementById('registerHeight').value),
      password: document.getElementById('registerPassword').value
    };

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await readApiResponse(response);
      if (!response.ok) throw new Error(result.message || 'Registration failed');

      localStorage.removeItem('foodieUser');
      showToast('Account created. Redirecting to login...');
      registerForm.reset();
      setTimeout(() => {
        window.location.href = 'login.html';
      }, 1200);
    } catch (error) {
      showToast(error.message);
    }
  });
}

if (passwordResetRequestForm) {
  const deliverySelect = document.getElementById('reset-delivery');
  const submitButton = document.getElementById('reset-request-submit');
  const updateResetSubmitLabel = () => {
    submitButton.textContent = deliverySelect.value === 'whatsapp'
      ? 'WhatsApp me a reset link'
      : 'Email me a reset link';
  };
  deliverySelect.addEventListener('change', updateResetSubmitLabel);

  passwordResetRequestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.getElementById('password-reset-request-status');
    status.textContent = 'Sending reset link…';
    status.classList.remove('error');
    submitButton.disabled = true;
    try {
      const response = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('reset-email').value.trim(),
          delivery: deliverySelect.value
        })
      });
      const result = await readApiResponse(response);
      if (!response.ok) throw new Error(result.message || 'Unable to request a reset link.');
      status.textContent = result.message;
      document.getElementById('reset-email').value = '';
    } catch (error) {
      status.textContent = error.message;
      status.classList.add('error');
    } finally {
      submitButton.disabled = false;
    }
  });
}

if (passwordResetCompleteForm) {
  const resetToken = new URLSearchParams(window.location.search).get('token') || '';
  const requestForm = document.getElementById('password-reset-request-form');
  const completeStatus = document.getElementById('password-reset-complete-status');
  const requestStatus = document.getElementById('password-reset-request-status');
  if (resetToken) {
    requestForm.hidden = true;
    passwordResetCompleteForm.hidden = false;
    window.history.replaceState(null, '', window.location.pathname);
  } else {
    passwordResetCompleteForm.hidden = true;
    requestStatus.textContent = 'Enter your account email address and we will send a reset link if it is registered.';
  }

  passwordResetCompleteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = document.getElementById('reset-new-password').value;
    const confirmPassword = document.getElementById('reset-confirm-password').value;
    if (password !== confirmPassword) {
      completeStatus.textContent = 'The passwords do not match.';
      completeStatus.classList.add('error');
      return;
    }

    const submitButton = passwordResetCompleteForm.querySelector('button[type="submit"]');
    completeStatus.textContent = 'Updating your password…';
    completeStatus.classList.remove('error');
    submitButton.disabled = true;
    try {
      const response = await fetch('/api/auth/password-reset/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, password })
      });
      const result = await readApiResponse(response);
      if (!response.ok) throw new Error(result.message || 'Unable to reset your password.');
      passwordResetCompleteForm.reset();
      completeStatus.textContent = result.message;
      window.setTimeout(() => { window.location.href = 'login.html'; }, 1800);
    } catch (error) {
      completeStatus.textContent = error.message;
      completeStatus.classList.add('error');
    } finally {
      submitButton.disabled = false;
    }
  });
}
