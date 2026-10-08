const userLoginForm = document.getElementById('login-form');
const adminLoginForm = document.getElementById('admin-login-form');
const registerForm = document.getElementById('register-form');
const toast = document.getElementById('toast');

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => toast.classList.remove('show'), 2600);
}

const loginForms = [userLoginForm, adminLoginForm].filter(Boolean);
loginForms.forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const requestedRole = form.id === 'admin-login-form'
      ? 'admin'
      : form.id === 'cashier-login-form'
        ? 'cashier'
        : 'user';
    const payload = {
      username: document.getElementById(form.id === 'admin-login-form' ? 'adminLoginUsername' : 'loginUsername').value.trim(),
      password: document.getElementById(form.id === 'admin-login-form' ? 'adminLoginPassword' : 'loginPassword').value,
      role: requestedRole
    };

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Login failed');

      localStorage.setItem('foodieUser', JSON.stringify(result.user));
      showToast('Login successful');

      if (result.user.role === 'admin') {
        window.location.href = 'admin.html';
      } else if (result.user.role === 'cashier') {
        window.location.href = 'cashier.html';
      } else {
        window.location.href = 'home.html';
      }
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

      const result = await response.json();
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
