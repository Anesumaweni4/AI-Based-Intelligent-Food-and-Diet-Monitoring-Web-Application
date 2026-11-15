// Admin panel: Deliveries. Shows every delivery order, which rider has it, the
// riders on shift and today's totals. The admin can give an order to a rider,
// move it to another rider, or open it for any rider again.
(() => {
  const section = document.getElementById('deliveries');
  if (!section) return;

  const $ = (id) => document.getElementById(id);
  const statusEl = $('dl-status');
  const statsEl = $('dl-stats');
  const ridersEl = $('dl-riders');
  const ordersEl = $('dl-orders');
  const searchEl = $('dl-search');
  const tabs = Array.from(section.querySelectorAll('[data-dl-view]'));
  const badge = document.querySelector('[data-quick-badge="deliveries"]');

  let view = 'active';
  let board = null;
  let loading = false;
  let busyOrder = null;

  const escapeText = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const money = (value) => `$${(Number(value) || 0).toFixed(2)}`;

  // Orders store UTC wall time without a zone ("2026-11-15 08:30:00").
  const toDate = (value) => {
    if (!value) return null;
    const text = String(value);
    const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const timeText = (value) => {
    const date = toDate(value);
    return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  };
  const dayTime = (value) => {
    const date = toDate(value);
    if (!date) return '';
    const sameDay = date.toDateString() === new Date().toDateString();
    return sameDay ? `Today ${timeText(value)}` : date.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  const minutesAgo = (value) => {
    const date = toDate(value);
    if (!date) return null;
    return Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  };

  const STEP = {
    Pending: { label: 'New order', tone: 'amber' },
    Preparing: { label: 'Kitchen preparing', tone: 'amber' },
    'Ready for Pickup': { label: 'Ready for rider', tone: 'blue' },
    'Out for Delivery': { label: 'On the way', tone: 'blue' },
    Delivered: { label: 'Delivered', tone: 'green' },
    Cancelled: { label: 'Cancelled', tone: 'grey' },
    Collected: { label: 'Collected', tone: 'green' }
  };

  function renderStats(stats) {
    const tiles = [
      ['Waiting for a rider', stats.needRider, stats.needRider ? 'Assign one below' : 'All orders have a rider', stats.needRider ? 'alert' : ''],
      ['Rider assigned', stats.withRider, 'Being prepared or ready'],
      ['On the way', stats.onTheWay, 'Out for delivery now'],
      ['Delivered today', `${stats.deliveredToday}/${stats.placedToday}`, 'Delivered / placed today'],
      ['Delivery fees today', money(stats.feesToday), 'From delivered orders'],
      ['Cash with riders', money(stats.cashOnTheRoad), 'Cash orders not yet delivered']
    ];
    statsEl.innerHTML = tiles.map(([label, value, note, tone]) => `
      <div class="di-stat${tone ? ` dl-stat-${tone}` : ''}">
        <span>${escapeText(label)}</span>
        <strong>${escapeText(value)}</strong>
        <small>${escapeText(note)}</small>
      </div>`).join('');
    if (badge) {
      badge.hidden = !stats.needRider;
      badge.textContent = stats.needRider ? String(stats.needRider) : '';
    }
  }

  function renderRiders(riders) {
    if (!riders.length) {
      ridersEl.innerHTML = `
        <div class="dl-empty">
          <strong>No rider accounts yet.</strong>
          <span>Go to <a href="#settings">Team &amp; security</a>, choose <b>Delivery rider</b> and create one. Riders sign in on the normal login page and go straight to the rider app.</span>
        </div>`;
      return;
    }
    ridersEl.innerHTML = riders.map((rider) => `
      <div class="dl-rider">
        <span class="dl-avatar" aria-hidden="true">${escapeText(rider.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join(''))}</span>
        <div class="dl-rider-text">
          <strong>${escapeText(rider.name)}</strong>
          <small>@${escapeText(rider.username)}</small>
        </div>
        <span class="dl-dot ${rider.online ? 'is-online' : ''}">${rider.online ? 'Online' : 'Offline'}</span>
        <div class="dl-rider-numbers">
          <span><b>${rider.activeJobs}</b> active</span>
          <span><b>${rider.deliveredToday}</b> delivered today</span>
          <span><b>${money(rider.feesToday)}</b> fees</span>
        </div>
      </div>`).join('');
  }

  function riderSelect(order) {
    const riders = board.riders;
    if (!riders.length) return '';
    const finished = ['Delivered', 'Cancelled', 'Collected'].includes(order.status);
    if (finished) return '';
    const options = [
      order.status === 'Out for Delivery' ? '' : `<option value="">Any rider (open job)</option>`,
      ...riders.map((rider) => `<option value="${rider.id}" ${Number(order.riderId) === rider.id ? 'selected' : ''}>${escapeText(rider.name)}${rider.online ? ' · online' : ''}</option>`)
    ];
    if (order.riderId && !riders.some((rider) => rider.id === Number(order.riderId))) {
      options.push(`<option value="${order.riderId}" selected disabled>${escapeText(order.riderName)} (staff)</option>`);
    }
    return `
      <label class="dl-assign">
        <span>${order.riderId ? 'Rider' : 'Give to'}</span>
        <select data-dl-assign="${order.id}" ${busyOrder === order.id ? 'disabled' : ''}>${options.join('')}</select>
      </label>`;
  }

  function orderCard(order) {
    const step = STEP[order.status] || { label: order.status, tone: 'grey' };
    const items = order.items.map((item) => `${item.quantity}× ${escapeText(item.name)}`).join(', ');
    const waited = minutesAgo(order.createdAt);
    const late = ['Pending', 'Preparing', 'Ready for Pickup', 'Out for Delivery'].includes(order.status) && waited !== null && waited >= 45;
    const mapLink = order.destination
      ? `<a href="https://www.google.com/maps/search/?api=1&query=${order.destination.lat},${order.destination.lng}" target="_blank" rel="noopener">Student's location</a>`
      : '';
    const riderLink = order.riderLocation
      ? `<a href="https://www.google.com/maps/search/?api=1&query=${order.riderLocation.lat},${order.riderLocation.lng}" target="_blank" rel="noopener">Rider now</a>`
      : '';
    const phone = String(order.phone || '').replace(/[^\d+]/g, '');
    const timeline = order.status === 'Delivered'
      ? `Delivered ${timeText(order.deliveredAt)}`
      : order.status === 'Out for Delivery'
        ? `Left the kitchen ${timeText(order.dispatchedAt)}`
        : `Placed ${dayTime(order.createdAt)}${waited !== null && order.status !== 'Cancelled' ? ` · ${waited} min ago` : ''}`;
    return `
      <article class="dl-order${late ? ' is-late' : ''}${!order.riderId && step.tone !== 'green' && order.status !== 'Cancelled' ? ' needs-rider' : ''}">
        <header class="dl-order-head">
          <div>
            <strong>#${order.id} · ${escapeText(order.customerName)}</strong>
            <small>${escapeText(timeline)}${late ? ' · running late' : ''}</small>
          </div>
          <span class="dl-chip dl-chip-${step.tone}">${escapeText(step.label)}</span>
        </header>
        <dl class="dl-order-info">
          <div><dt>Residence</dt><dd>${escapeText(order.address)}</dd></div>
          <div><dt>Phone</dt><dd>${phone ? `<a href="tel:${escapeText(phone)}">${escapeText(order.phone)}</a>` : '—'}</dd></div>
          <div><dt>Rider</dt><dd>${order.riderName ? escapeText(order.riderName) : '<em>Not assigned</em>'}</dd></div>
          <div><dt>Payment</dt><dd>${order.paymentMethod === 'cash' ? `Cash · collect ${money(order.total)}` : order.paymentMethod === 'monthly' ? 'Monthly account' : 'Student credit (paid)'}</dd></div>
        </dl>
        <p class="dl-items">${items || 'No items'}${order.note ? ` <em>· Note: ${escapeText(order.note)}</em>` : ''}</p>
        <footer class="dl-order-foot">
          <span class="dl-total">${money(order.total)} <small>incl. ${money(order.deliveryFee)} delivery</small></span>
          <span class="dl-links">${mapLink}${riderLink}</span>
          ${riderSelect(order)}
        </footer>
      </article>`;
  }

  function renderOrders() {
    if (!board) return;
    const query = searchEl.value.trim().toLowerCase().replace(/^#/, '');
    const list = board.orders.filter((order) => !query || [order.id, order.customerName, order.phone, order.address, order.riderName]
      .some((value) => String(value ?? '').toLowerCase().includes(query)));
    if (!list.length) {
      const empty = query ? 'No delivery matches your search.'
        : view === 'active' ? 'No active deliveries right now. New delivery orders appear here as soon as students place them.'
          : view === 'today' ? 'No delivery orders today yet.' : 'No delivery orders yet.';
      ordersEl.innerHTML = `<div class="dl-empty"><span>${empty}</span></div>`;
      return;
    }
    ordersEl.innerHTML = list.map(orderCard).join('');
  }

  async function load({ quiet = false, keepStatus = false } = {}) {
    if (loading) return;
    // Don't redraw while the admin has a rider list open.
    if (quiet && document.activeElement && document.activeElement.matches('[data-dl-assign]')) return;
    loading = true;
    try {
      const response = await fetch(`/api/admin/deliveries?view=${view}`, { credentials: 'include', cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to load deliveries.');
      board = data;
      renderStats(data.stats);
      renderRiders(data.riders);
      renderOrders();
      if (keepStatus) return;
      statusEl.classList.remove('is-error');
      statusEl.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    } catch (error) {
      statusEl.classList.add('is-error');
      statusEl.textContent = error.message;
    } finally {
      loading = false;
    }
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => {
    view = tab.dataset.dlView;
    tabs.forEach((other) => {
      const active = other === tab;
      other.classList.toggle('is-active', active);
      other.setAttribute('aria-selected', String(active));
    });
    ordersEl.innerHTML = '<div class="dl-empty"><span>Loading…</span></div>';
    load();
  }));
  searchEl.addEventListener('input', renderOrders);

  ordersEl.addEventListener('change', async (event) => {
    const select = event.target.closest('[data-dl-assign]');
    if (!select) return;
    const orderId = Number(select.dataset.dlAssign);
    busyOrder = orderId;
    select.disabled = true;
    try {
      const response = await fetch(`/api/admin/deliveries/${orderId}/rider`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riderId: select.value || null })
      });
      const data = await response.json().catch(() => ({}));
      statusEl.classList.toggle('is-error', !response.ok);
      statusEl.textContent = data.message || (response.ok ? 'Saved.' : 'Unable to assign the rider.');
    } catch {
      statusEl.classList.add('is-error');
      statusEl.textContent = 'No connection. Try again.';
    } finally {
      busyOrder = null;
      select.blur();
      load({ keepStatus: true });
    }
  });

  load();
  setInterval(() => {
    if (!document.hidden) load({ quiet: true });
  }, 6000);
})();
