// Styles live here so the dialog looks the same on every page that loads this
// script, including pages that do not load theme.css.
const accessDialogStyles = document.createElement('style');
accessDialogStyles.textContent = `
  .access-dialog {
    width: min(400px, calc(100% - 32px));
    max-height: calc(100vh - 32px);
    margin: auto;
    padding: 0;
    overflow: hidden auto;
    border: 0;
    border-radius: 24px;
    background: #fff;
    color: #241813;
    box-shadow: 0 30px 80px rgba(24, 16, 12, 0.32);
    font-family: "Plus Jakarta Sans", "Segoe UI", system-ui, Arial, sans-serif;
    animation: access-in 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .access-dialog::backdrop {
    background: rgba(30, 20, 15, 0.5);
    backdrop-filter: blur(4px);
  }
  @keyframes access-in {
    from { opacity: 0; transform: translateY(14px) scale(0.97); }
    to { opacity: 1; transform: none; }
  }
  .access-art {
    position: relative;
    display: grid;
    height: 118px;
    place-items: center;
    background:
      radial-gradient(60% 90% at 85% 0%, rgba(224, 181, 106, 0.4), transparent 60%),
      radial-gradient(60% 90% at 10% 100%, rgba(162, 74, 48, 0.55), transparent 65%),
      #241813;
  }
  .access-art::after {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 26px;
    border-radius: 24px 24px 0 0;
    background: #fff;
    content: "";
  }
  .access-badge {
    position: relative;
    z-index: 1;
    display: grid;
    width: 70px;
    height: 70px;
    margin-top: 22px;
    place-items: center;
    border: 5px solid #fff;
    border-radius: 50%;
    background: linear-gradient(135deg, #e0b56a, #c0703f);
    box-shadow: 0 12px 28px rgba(24, 16, 12, 0.28);
    color: #fff;
  }
  .access-badge svg {
    width: 30px;
    height: 30px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .access-tag {
    position: absolute;
    top: 14px;
    right: 14px;
    padding: 4px 10px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.1);
    color: #f6dfb4;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .access-body {
    padding: 6px 26px 24px;
    text-align: center;
  }
  .access-body h2 {
    margin: 0 0 10px;
    font-family: "Fraunces", Georgia, "Times New Roman", serif;
    font-size: 1.55rem;
    font-weight: 600;
    line-height: 1.15;
    letter-spacing: -0.01em;
  }
  .access-body p {
    margin: 0 0 22px;
    color: #7a6d62;
    line-height: 1.6;
  }
  .access-actions {
    display: grid;
    gap: 10px;
  }
  .access-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 50px;
    padding: 0 20px;
    border-radius: 14px;
    font: inherit;
    font-weight: 700;
    text-decoration: none;
    cursor: pointer;
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease, background 0.18s ease;
  }
  .access-btn svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .access-btn--primary {
    border: 0;
    background: linear-gradient(135deg, #b5563a 0%, #a24a30 45%, #7f3523 100%);
    box-shadow: 0 10px 24px rgba(162, 74, 48, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.18);
    color: #fff;
  }
  .access-btn--primary:hover,
  .access-btn--primary:focus-visible {
    box-shadow: 0 14px 30px rgba(162, 74, 48, 0.34), 0 0 0 4px rgba(162, 74, 48, 0.18);
    outline: none;
    transform: translateY(-1px);
  }
  .access-btn--secondary {
    border: 1.5px solid #dccbb8;
    background: #fff;
    color: #3a2a22;
  }
  .access-btn--secondary:hover,
  .access-btn--secondary:focus-visible {
    border-color: #a24a30;
    color: #a24a30;
    box-shadow: 0 0 0 4px rgba(162, 74, 48, 0.12);
    outline: none;
  }
  .access-btn--ghost {
    min-height: 40px;
    border: 0;
    background: transparent;
    color: #7a6d62;
    font-weight: 600;
  }
  .access-btn--ghost:hover,
  .access-btn--ghost:focus-visible {
    background: #f6efe6;
    color: #241813;
    outline: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .access-dialog { animation: none; }
  }
`;
document.head.appendChild(accessDialogStyles);

const ACCESS_ICONS = {
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><path d="M12 15v2"/>',
  staff: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  userPlus: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/><path d="M19 8v6M16 11h6"/>'
};

const accessDialog = document.createElement('dialog');
accessDialog.className = 'access-dialog';
accessDialog.setAttribute('aria-labelledby', 'access-dialog-title');
accessDialog.setAttribute('aria-describedby', 'access-dialog-message');
accessDialog.innerHTML = `
  <div class="access-art" aria-hidden="true">
    <span class="access-tag" id="access-dialog-tag">Sign-in required</span>
    <span class="access-badge"><svg viewBox="0 0 24 24" id="access-dialog-icon"></svg></span>
  </div>
  <div class="access-body">
    <h2 id="access-dialog-title"></h2>
    <p id="access-dialog-message"></p>
    <div id="access-dialog-actions" class="access-actions"></div>
  </div>
`;
document.body.appendChild(accessDialog);

const accessDialogTitle = accessDialog.querySelector('#access-dialog-title');
const accessDialogMessage = accessDialog.querySelector('#access-dialog-message');
const accessDialogActions = accessDialog.querySelector('#access-dialog-actions');
const accessDialogTag = accessDialog.querySelector('#access-dialog-tag');
const accessDialogIcon = accessDialog.querySelector('#access-dialog-icon');
let accessCheckPending = false;

function showAccessDialog({ title, message, tag, icon, links }) {
  accessDialogTitle.textContent = title;
  accessDialogMessage.textContent = message;
  accessDialogTag.textContent = tag;
  accessDialogIcon.innerHTML = ACCESS_ICONS[icon] || ACCESS_ICONS.lock;
  accessDialogActions.replaceChildren();

  for (const { label, href, style = 'primary', icon: buttonIcon } of links) {
    const element = document.createElement(href ? 'a' : 'button');
    element.className = `access-btn access-btn--${href ? style : 'ghost'}`;
    if (href) {
      element.href = href;
    } else {
      element.type = 'button';
      element.addEventListener('click', () => accessDialog.close());
    }
    element.append(label);
    if (buttonIcon) {
      element.insertAdjacentHTML('beforeend', `<svg viewBox="0 0 24 24" aria-hidden="true">${ACCESS_ICONS[buttonIcon]}</svg>`);
    }
    accessDialogActions.appendChild(element);
  }

  accessDialog.showModal();
  accessDialogActions.querySelector('.access-btn')?.focus();
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
      showAccessDialog(isHomeLink
        ? {
            tag: 'Sign-in required',
            icon: 'lock',
            title: 'Sign in to start ordering',
            message: 'Log in or create a free student account to open your Home dashboard, browse today’s menu and track your orders.',
            links: [
              { label: 'Log in', href: 'login.html', style: 'primary', icon: 'arrow' },
              { label: 'Create a student account', href: 'register.html', style: 'secondary', icon: 'userPlus' },
              { label: 'Not now' }
            ]
          }
        : {
            tag: 'Staff only',
            icon: 'staff',
            title: 'Staff sign-in needed',
            message: 'The Restaurant and Delivery dashboards are for cashiers and administrators. Sign in with your staff account to continue.',
            links: [
              { label: 'Log in as staff', href: 'login.html', style: 'primary', icon: 'arrow' },
              { label: 'Not now' }
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
