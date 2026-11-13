// Admin panel chrome: one section at a time ("views"), greeting, mobile
// drawer, quick-tile badges and logout. Data loading lives in admin.js.
(() => {
  const body = document.body;
  const sidebar = document.getElementById('admin-sidebar');
  const menuToggle = document.getElementById('admin-menu-toggle');
  const scrim = document.getElementById('admin-scrim');
  const pageTitle = document.getElementById('admin-page-title');
  const backLink = document.getElementById('admin-back');
  const dateLabel = document.getElementById('admin-date');

  // ---------- Greeting + date ----------
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const todayText = now.toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  if (dateLabel) dateLabel.textContent = todayText;

  // ---------- Signed-in admin name ----------
  try {
    const user = JSON.parse(localStorage.getItem('foodieUser') || 'null');
    const name = user?.fullName || user?.full_name || user?.username;
    if (name) {
      const nameEl = document.getElementById('admin-profile-name');
      const avatarEl = document.getElementById('admin-avatar');
      if (nameEl) nameEl.textContent = name;
      if (avatarEl) {
        avatarEl.textContent = name.split(/\s+/).filter(Boolean).slice(0, 2)
          .map((part) => part[0].toUpperCase()).join('');
      }
    }
  } catch {
    // Unreadable local storage: keep the defaults.
  }

  // ---------- Mobile drawer ----------
  const setSidebar = (open) => {
    body.classList.toggle('sidebar-open', open);
    menuToggle?.setAttribute('aria-expanded', String(open));
  };
  menuToggle?.addEventListener('click', () => setSidebar(!body.classList.contains('sidebar-open')));
  scrim?.addEventListener('click', () => setSidebar(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && body.classList.contains('sidebar-open')) setSidebar(false);
  });

  // ---------- Views: show one section at a time ----------
  const navLinks = Array.from(sidebar?.querySelectorAll('.admin-side-nav a[href^="#"]') || []);
  const views = new Map();
  navLinks.forEach((link) => {
    const id = link.getAttribute('href').slice(1);
    const section = document.getElementById(id);
    if (!section) return;
    section.classList.add('admin-view');
    views.set(id, { section, label: link.textContent.trim() });
  });
  const defaultView = 'overview';

  const showView = (requested, { focus = false } = {}) => {
    const id = views.has(requested) ? requested : defaultView;
    views.forEach(({ section }, key) => {
      section.hidden = key !== id;
    });
    navLinks.forEach((link) => {
      const active = link.getAttribute('href') === `#${id}`;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    const isHome = id === defaultView;
    if (pageTitle) {
      if (isHome) {
        pageTitle.innerHTML = '';
        const span = document.createElement('span');
        span.id = 'admin-greeting';
        span.textContent = greeting;
        pageTitle.append(span, ' 👋');
      } else {
        pageTitle.textContent = views.get(id).label;
      }
    }
    if (backLink) backLink.hidden = isHome;
    const appTitle = body.dataset.appTitle || 'Admin Dashboard';
    document.title = isHome ? `${appTitle} | THE KITCHEN` : `${views.get(id).label} | ${appTitle} | THE KITCHEN`;
    body.dataset.adminView = id;

    window.scrollTo({ top: 0, behavior: 'auto' });
    if (focus) {
      const heading = views.get(id).section.querySelector('h2, h3');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    }
  };

  const currentHash = () => decodeURIComponent(window.location.hash.slice(1));

  // Clicking a sidebar link, quick tile or the back link changes the hash;
  // hashchange then switches the view (so Back/Forward work too).
  window.addEventListener('hashchange', () => {
    setSidebar(false);
    showView(currentHash(), { focus: true });
  });
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const id = link.getAttribute('href').slice(1);
    if (!views.has(id)) return;
    setSidebar(false);
    // Re-clicking the current view's link: just scroll back to its top.
    if (id === currentHash() || (!currentHash() && id === defaultView)) {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
  showView(currentHash());

  // ---------- Live badges on the overview tiles ----------
  const setBadge = (key, count, label, tone = '') => {
    const badge = document.querySelector(`[data-quick-badge="${key}"]`);
    if (!badge) return;
    badge.hidden = !count;
    badge.textContent = count ? `${count} ${label}` : '';
    badge.dataset.tone = tone;
  };
  const watch = (el, fn) => {
    if (!el) return;
    fn();
    new MutationObserver(fn).observe(el, { childList: true, subtree: true, characterData: true });
  };

  watch(document.getElementById('admin-summary'), () => {
    const pendingCard = Array.from(document.querySelectorAll('#admin-summary .stat-card'))
      .find((card) => card.querySelector('span')?.textContent.trim().toLowerCase() === 'pending');
    setBadge('orders', Number(pendingCard?.querySelector('strong')?.textContent) || 0, 'pending', 'amber');
  });
  watch(document.getElementById('stock-onhand'), () => {
    setBadge('stock', document.querySelectorAll('#stock-onhand .stock-item.is-empty').length, 'out of stock', 'red');
  });
  watch(document.getElementById('di-risk'), () => {
    const high = Number(document.querySelector('#di-risk [data-risk-count="high"]')?.textContent) || 0;
    setBadge('diet', high, 'at high risk', 'red');
  });
  watch(document.getElementById('client-feedback-list'), () => {
    const newCount = Number(document.querySelector('#client-feedback-list [data-feedback-filter="new"] span')?.textContent) || 0;
    setBadge('feedback', newCount, 'new', 'red');
  });

  // ---------- Logout ----------
  document.getElementById('admin-logout')?.addEventListener('click', async () => {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to log out safely.');
      localStorage.removeItem('foodieUser');
      window.location.href = body.dataset.logoutRedirect || 'admin-login.html';
    } catch (error) {
      window.alert(error.message);
    }
  });
})();
