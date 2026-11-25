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
  // "My orders" is a page of its own: #my-orders shows only the orders,
  // any other address shows the welcome banner and the menu.
  const ordersPage = $('my-orders');
  const homeParts = ['top', 'menu'].map($).filter(Boolean);
  const isOrdersView = () => window.location.hash === '#my-orders';
  const applyView = (scroll) => {
    if (!ordersPage) return;
    const orders = isOrdersView();
    const changed = ordersPage.hidden === orders;
    ordersPage.hidden = !orders;
    homeParts.forEach((part) => { part.hidden = orders; });
    document.body.classList.toggle('view-orders', orders);
    document.title = orders ? 'My orders · THE KITCHEN' : document.title.replace(/^My orders · /, '');
    if (!scroll && !changed) return;
    if (orders) {
      window.scrollTo(0, 0);
    } else {
      const target = window.location.hash && window.location.hash !== '#checkout'
        ? document.querySelector(window.location.hash) : null;
      if (target) target.scrollIntoView();
      else if (changed) window.scrollTo(0, 0);
    }
  };
  applyView(false);
  window.addEventListener('hashchange', () => { applyView(true); requestAnimationFrame(onScroll); });

  let ticking = false;
  function onScroll() {
    ticking = false;
    topbar?.classList.toggle('is-scrolled', window.scrollY > 8);
    if (!sections.length) return;
    let current = null;
    for (const section of sections) {
      if (section.hidden) continue;
      if (section.getBoundingClientRect().top - 120 <= 0) current = section;
    }
    if (ordersPage && isOrdersView()) current = ordersPage;
    else if (ordersPage && !current) current = $('menu');
    sectionLinks.forEach((link) => {
      const active = current && link.getAttribute('href') === `#${current.id}`;
      link.classList.toggle('is-active', Boolean(active));
    });
  }
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

  // ---------- Cart count (menu bar badge) ----------
  let lastCartTotal = null;
  const showCartTotal = (total) => {
    document.querySelectorAll('[data-cart-count]').forEach((badge) => {
      badge.textContent = total > 99 ? '99+' : String(total);
      badge.hidden = total === 0;
      if (lastCartTotal !== null && total > lastCartTotal) {
        badge.classList.remove('is-bumping');
        void badge.offsetWidth;
        badge.classList.add('is-bumping');
      }
    });
    document.querySelectorAll('.client-nav-cart').forEach((link) => {
      link.setAttribute('aria-label', `Cart, ${total} item${total === 1 ? '' : 's'}`);
    });
    lastCartTotal = total;
  };
  if ($('cart-items')) {
    watch($('cart-items'), () => {
      const total = Array.from(document.querySelectorAll('#cart-items .qty-controls span'))
        .reduce((sum, span) => sum + (Number(span.textContent) || 0), 0);
      showCartTotal(total);
    });
  } else {
    // Other pages: show the count of the cart saved on the menu page.
    try {
      const saved = JSON.parse(sessionStorage.getItem('kitchenCart') || '[]');
      showCartTotal(Array.isArray(saved) ? saved.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) : 0);
    } catch {
      showCartTotal(0);
    }
  }

  // ---------- Cart drawer (cart + payment) ----------
  const drawer = $('checkout');
  const overlay = $('cart-overlay');
  if (drawer && drawer.classList.contains('cart-drawer')) {
    let returnFocus = null;
    const openCart = () => {
      if (drawer.classList.contains('is-open')) return;
      returnFocus = document.activeElement;
      overlay.hidden = false;
      drawer.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => {
        overlay.classList.add('is-open');
        drawer.classList.add('is-open');
      });
      document.body.classList.add('cart-open');
      $('cart-drawer-close')?.focus({ preventScroll: true });
    };
    const closeCart = () => {
      if (!drawer.classList.contains('is-open')) return;
      drawer.classList.remove('is-open');
      overlay.classList.remove('is-open');
      drawer.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('cart-open');
      setTimeout(() => { overlay.hidden = true; }, 250);
      if (window.location.hash === '#checkout') history.replaceState(null, '', window.location.pathname);
      if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus({ preventScroll: true });
    };
    window.openCart = openCart;
    window.closeCart = closeCart;
    document.addEventListener('click', (event) => {
      const link = event.target.closest('a[href="#checkout"]');
      if (!link) return;
      event.preventDefault();
      openCart();
    });
    $('cart-drawer-close')?.addEventListener('click', closeCart);
    overlay.addEventListener('click', closeCart);
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !drawer.classList.contains('is-open')) return;
      if (document.querySelector('dialog[open]')) return; // let the payment dialog close first
      closeCart();
    });
    // Keep keyboard focus inside the open drawer
    drawer.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusable = Array.from(drawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled])'))
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    if (window.location.hash === '#checkout') openCart();
  }

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
