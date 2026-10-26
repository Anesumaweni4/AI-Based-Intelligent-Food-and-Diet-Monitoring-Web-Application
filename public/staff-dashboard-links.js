const accessDialog = document.createElement('dialog');
accessDialog.className = 'notice-dialog';
accessDialog.setAttribute('aria-labelledby', 'access-dialog-title');
accessDialog.innerHTML = `
  <div class="notice-dialog-content">
    <p class="eyebrow">Sign-in required</p>
    <h2 id="access-dialog-title"></h2>
    <p id="access-dialog-message"></p>
    <div id="access-dialog-actions" class="payment-choice-actions"></div>
  </div>
`;
document.body.appendChild(accessDialog);

const accessDialogTitle = accessDialog.querySelector('#access-dialog-title');
const accessDialogMessage = accessDialog.querySelector('#access-dialog-message');
const accessDialogActions = accessDialog.querySelector('#access-dialog-actions');
let accessCheckPending = false;

function showAccessDialog({ title, message, links }) {
  accessDialogTitle.textContent = title;
  accessDialogMessage.textContent = message;
  accessDialogActions.replaceChildren();

  for (const { label, href } of links) {
    if (href) {
      const link = document.createElement('a');
      link.className = 'submit-btn';
      link.href = href;
      link.textContent = label;
      accessDialogActions.appendChild(link);
      continue;
    }

    const button = document.createElement('button');
    button.className = 'admin-gate-cancel';
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => accessDialog.close());
    accessDialogActions.appendChild(button);
  }

  accessDialog.showModal();
}

document.addEventListener('click', async (event) => {
  const link = event.target.closest('a[href="home.html"], a[href="restaurant.html"], a[href="delivery.html"]');
  if (!link) return;

  event.preventDefault();
  if (accessCheckPending) return;

  const isHomeLink = link.getAttribute('href') === 'home.html';
  accessCheckPending = true;
  try {
    const response = await fetch(isHomeLink ? '/api/student/session' : '/api/staff/session');
    if (response.status === 401) {
      showAccessDialog({
        title: 'Log in or create an account',
        message: isHomeLink
          ? 'Please log in or create a student account to open the Home dashboard.'
          : 'Please sign in to continue. Restaurant and Delivery dashboards require a cashier or administrator account.',
        links: [
          { label: 'Log in', href: 'login.html' },
          { label: 'Create account', href: 'register.html' },
          { label: 'Cancel' }
        ]
      });
      return;
    }
    if (!response.ok) {
      console.error('Unable to verify dashboard login:', response.status);
      return;
    }

    window.location.assign(link.href);
  } catch (error) {
    console.error('Unable to verify dashboard login:', error);
  } finally {
    accessCheckPending = false;
  }
}, true);

accessDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  accessDialog.close();
});
