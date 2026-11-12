// Client page chrome: greeting, logout, cart badge, menu search/filters,
// hero stats and order status colours. It only *reads* what app.js renders,
// so ordering logic stays entirely in app.js.
(() => {
  const $ = (id) => document.getElementById(id);

  // ---------- Greeting, name, avatar ----------
  let user = null;
  try {
    user = JSON.parse(localStorage.getItem('foodieUser') || 'null');
  } catch {
    user = null;
  }
  const fullName = (user?.fullName || user?.full_name || user?.username || '').trim();
  const firstName = fullName.split(/\s+/)[0] || '';
  const hour = new Date().getHours();

  if ($('client-greeting')) {
    $('client-greeting').textContent = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  }
  if ($('client-first-name') && firstName) $('client-first-name').textContent = firstName;
  if ($('hero-date')) {
    $('hero-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  }
  if ($('client-avatar') && fullName) {
    $('client-avatar').textContent = fullName.split(/\s+/).filter(Boolean).slice(0, 2)
      .map((part) => part[0].toUpperCase()).join('');
    $('client-avatar').title = `Signed in as ${fullName}`;
  }

  // ---------- Logout ----------
  $('client-logout')?.addEventListener('click', async () => {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to log out.');
      localStorage.removeItem('foodieUser');
      window.location.href = 'login.html';
    } catch (error) {
      window.alert(error.message);
    }
  });

  // ---------- Topbar shadow + active nav link ----------
  const topbar = document.querySelector('.client-topbar');
  const sectionLinks = Array.from(document.querySelectorAll('[data-section-link]'));
  const sections = sectionLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);
  let ticking = false;
  const onScroll = () => {
    ticking = false;
    topbar?.classList.toggle('is-scrolled', window.scrollY > 8);
    if (!sections.length) return;
    let current = null;
    for (const section of sections) {
      if (section.getBoundingClientRect().top - 120 <= 0) current = section;
    }
    sectionLinks.forEach((link) => {
      const active = current && link.getAttribute('href') === `#${current.id}`;
      link.classList.toggle('is-active', Boolean(active));
    });
  };
  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(onScroll);
    }
  }, { passive: true });
  onScroll();

  // Helper: run fn now and whenever el's children change.
  const watch = (el, fn, options = { childList: true, subtree: true, characterData: true }) => {
    if (!el) return;
    fn();
    new MutationObserver(fn).observe(el, options);
  };

  // ---------- Cart count ----------
  const cartCount = $('cart-count');
  watch($('cart-items'), () => {
    if (!cartCount) return;
    const total = Array.from(document.querySelectorAll('#cart-items .qty-controls span'))
      .reduce((sum, span) => sum + (Number(span.textContent) || 0), 0);
    cartCount.textContent = String(total);
    cartCount.hidden = total === 0;
  });

  // ---------- Hero: credit mirror ----------
  watch($('wallet-balance'), () => {
    const target = $('hero-credit');
    const text = $('wallet-balance')?.textContent || '';
    const amount = text.match(/-?\$\s?[\d,]+(?:\.\d+)?/);
    if (target) target.textContent = amount ? amount[0].replace(/\s/g, '') : '—';
  });

  // ---------- Orders: status colours + in-progress count ----------
  const doneStatuses = ['collected', 'delivered', 'cancelled'];
  const statusTone = (status) => {
    const s = status.toLowerCase();
    if (s.includes('cancel')) return 'cancelled';
    if (s.includes('collected') || s === 'delivered') return 'done';
    if (s.includes('ready') || s.includes('out for')) return 'ready';
    if (s.includes('prepar')) return 'preparing';
    return 'pending';
  };
  watch($('student-orders'), () => {
    const badges = document.querySelectorAll('#student-orders .badge');
    let active = 0;
    badges.forEach((badge) => {
      const status = badge.textContent.trim();
      const tone = statusTone(status);
      if (badge.dataset.tone !== tone) badge.dataset.tone = tone;
      if (!doneStatuses.includes(status.toLowerCase())) active += 1;
    });
    if ($('hero-orders')) $('hero-orders').textContent = String(active);
  }, { childList: true, subtree: true });

  // ---------- Menu: count, search and category filters ----------
  const menuGrid = $('menu-grid');
  const filtersEl = $('menu-filters');
  const searchInput = $('menu-search');
  const emptyEl = $('menu-filter-empty');
  let activeCategory = 'all';

  const applyMenuFilter = () => {
    if (!menuGrid) return;
    const query = (searchInput?.value || '').trim().toLowerCase();
    let visible = 0;
    const cards = menuGrid.querySelectorAll('.menu-card');
    cards.forEach((card) => {
      const category = (card.querySelector('.menu-category')?.textContent || '').trim().toLowerCase();
      const text = card.textContent.toLowerCase();
      const show = (activeCategory === 'all' || category === activeCategory) && (!query || text.includes(query));
      if (card.hidden === show) card.hidden = !show;
      if (show) visible += 1;
    });
    if (emptyEl) emptyEl.hidden = !(cards.length && visible === 0);
  };

  const renderFilters = () => {
    if (!filtersEl || !menuGrid) return;
    const cards = Array.from(menuGrid.querySelectorAll('.menu-card'));
    if ($('hero-meals')) $('hero-meals').textContent = cards.length ? String(cards.length) : '—';

    const categories = [...new Set(cards
      .map((card) => (card.querySelector('.menu-category')?.textContent || '').trim())
      .filter(Boolean))];
    const keys = ['all', ...categories.map((c) => c.toLowerCase())];
    if (!keys.includes(activeCategory)) activeCategory = 'all';

    const signature = keys.join('|');
    if (filtersEl.dataset.signature !== signature) {
      filtersEl.dataset.signature = signature;
      filtersEl.replaceChildren(...[['all', 'All meals'], ...categories.map((c) => [c.toLowerCase(), c])]
        .map(([key, label]) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'menu-filter';
          button.dataset.category = key;
          button.textContent = label;
          return button;
        }));
    }
    filtersEl.querySelectorAll('.menu-filter').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.category === activeCategory));
    });
    filtersEl.hidden = categories.length < 2;
    applyMenuFilter();
  };

  filtersEl?.addEventListener('click', (event) => {
    const button = event.target.closest('.menu-filter');
    if (!button) return;
    activeCategory = button.dataset.category;
    renderFilters();
  });
  searchInput?.addEventListener('input', applyMenuFilter);
  watch(menuGrid, renderFilters, { childList: true });
})();
