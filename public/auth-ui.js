// Show/hide password toggles for the sign-in pages.
document.querySelectorAll('.password-toggle').forEach((toggle) => {
  const input = document.getElementById(toggle.getAttribute('aria-controls'));
  if (!input) return;

  toggle.addEventListener('click', () => {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(reveal));
    toggle.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
    input.focus();
  });
});

// auth.js reads the password via input[type="password"], so make sure every
// field is masked again before its submit handler runs (capture phase).
document.addEventListener('submit', () => {
  document.querySelectorAll('.password-toggle[aria-pressed="true"]').forEach((toggle) => {
    const input = document.getElementById(toggle.getAttribute('aria-controls'));
    if (input) input.type = 'password';
    toggle.setAttribute('aria-pressed', 'false');
    toggle.setAttribute('aria-label', 'Show password');
  });
}, true);
