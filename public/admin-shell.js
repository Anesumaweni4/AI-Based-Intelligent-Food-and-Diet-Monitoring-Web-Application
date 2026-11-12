// Admin panel chrome: greeting, mobile sidebar drawer, active-section
// highlighting and logout. Data loading lives in admin.js.
(() => {
  const body = document.body;
  const sidebar = document.getElementById('admin-sidebar');
  const menuToggle = document.getElementById('admin-menu-toggle');
  const scrim = document.getElementById('admin-scrim');

  // Greeting + date
  const greeting = document.getElementById('admin-greeting');
  const dateLabel = document.getElementById('admin-date');
  const now = new Date();
  const hour = now.getHours();
  if (greeting) {
    greeting.textContent = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  }
  if (dateLabel) {
    dateLabel.textContent = now.toLocaleDateString(undefined, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  }

  // Signed-in admin name (stored by auth.js at login)
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
    // Ignore unreadable local storage; the defaults stay in place.
  }

  // Mobile drawer
  const setSidebar = (open) => {
    body.classList.toggle('sidebar-open', open);
    menuToggle?.setAttribute('aria-expanded', String(open));
  };
  menuToggle?.addEventListener('click', () => setSidebar(!body.classList.contains('sidebar-open')));
  scrim?.addEventListener('click', () => setSidebar(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && body.classList.contains('sidebar-open')) setSidebar(false);
  });

  // Active section highlighting
  const navLinks = Array.from(sidebar?.querySelectorAll('.admin-side-nav a[href^="#"]') || []);
  const sections = navLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  navLinks.forEach((link) => link.addEventListener('click', () => setSidebar(false)));

  let ticking = false;
  const updateActive = () => {
    ticking = false;
    const offset = 140;
    let current = sections[0];
    for (const section of sections) {
      if (section.getBoundingClientRect().top - offset <= 0) current = section;
    }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
      current = sections[sections.length - 1];
    }
    navLinks.forEach((link) => {
      const active = current && link.getAttribute('href') === `#${current.id}`;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  };
  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateActive);
    }
  }, { passive: true });
  updateActive();

  // Logout
  document.getElementById('admin-logout')?.addEventListener('click', async () => {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to log out safely.');
      localStorage.removeItem('foodieUser');
      window.location.href = 'admin-login.html';
    } catch (error) {
      window.alert(error.message);
    }
  });
})();
