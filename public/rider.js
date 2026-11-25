// Rider app: accept delivery jobs, pick them up, share live location while on
// the road, and confirm hand-over with the student's 4-digit code.
(() => {
  const $ = (id) => document.getElementById(id);
  const listEl = $('rd-list');
  const messageEl = $('rd-message');
  const onlineInput = $('rd-online');
  const codeDialog = $('rd-code-dialog');
  const codeInput = $('rd-code-input');
  const codeError = $('rd-code-error');

  let tab = 'mine';
  let data = { available: [], mine: [] };
  let knownAvailable = null;
  let watchId = null;
  let lastSent = 0;
  let wakeLock = null;
  let codeOrderId = null;
  let busy = false;

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = (value) => `$${Number(value || 0).toFixed(2)}`;

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...options });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.href = 'login.html';
      throw new Error('Please log in again.');
    }
    if (!response.ok) throw new Error(result.message || 'Something went wrong.');
    return result;
  }

  function say(text, tone = '') {
    messageEl.textContent = text || '';
    messageEl.dataset.tone = tone;
    if (text) {
      clearTimeout(say.timer);
      say.timer = setTimeout(() => { messageEl.textContent = ''; }, 6000);
    }
  }

  // ---------- Alerts for new jobs ----------
  function chime() {
    try {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18].forEach((delay, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = index ? 1046 : 784;
        gain.gain.setValueAtTime(0.0001, context.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.3, context.currentTime + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + delay + 0.25);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(context.currentTime + delay);
        oscillator.stop(context.currentTime + delay + 0.3);
      });
    } catch {
      // sound is optional
    }
    if (navigator.vibrate) navigator.vibrate([180, 80, 180]);
  }

  // ---------- Rendering ----------
  const STATUS = {
    Pending: ['New', 'grey'],
    Preparing: ['Cooking', 'amber'],
    'Ready for Pickup': ['Ready to collect', 'green'],
    'Out for Delivery': ['On the way', 'blue']
  };

  function directionsUrl(job) {
    if (job.destination) return `https://www.google.com/maps/dir/?api=1&destination=${job.destination.lat},${job.destination.lng}&travelmode=driving`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}`;
  }

  function actions(job) {
    if (!job.mine) {
      return `<button type="button" class="rd-btn rd-btn--primary" data-act="accept" data-id="${job.id}">Accept delivery</button>`;
    }
    if (job.status === 'Out for Delivery') {
      return `<a class="rd-btn rd-btn--ghost" href="${directionsUrl(job)}" target="_blank" rel="noopener">🧭 Directions</a>
        <button type="button" class="rd-btn rd-btn--green" data-act="deliver" data-id="${job.id}">Delivered ✓</button>`;
    }
    if (job.status === 'Ready for Pickup') {
      return `<button type="button" class="rd-btn rd-btn--ghost" data-act="release" data-id="${job.id}">Release</button>
        <button type="button" class="rd-btn rd-btn--primary" data-act="pickup" data-id="${job.id}">I've picked it up</button>`;
    }
    return `<button type="button" class="rd-btn rd-btn--ghost" data-act="release" data-id="${job.id}">Release</button>
      <span class="rd-wait">⏳ Waiting for the kitchen</span>`;
  }

  function card(job) {
    const [label, tone] = STATUS[job.status] || [job.status, 'grey'];
    const phone = String(job.phone || '').replace(/[^\d+]/g, '');
    const whatsapp = phone.replace(/^0/, '263').replace(/^\+/, '');
    return `
      <article class="rd-job rd-job--${tone}">
        <header>
          <div>
            <strong class="rd-job-id">#${job.id}</strong>
            <span class="rd-chip rd-chip--${tone}">${label}</span>
          </div>
          ${job.collectCash ? `<span class="rd-cash">Collect ${money(job.collectCash)}</span>` : '<span class="rd-paid">Paid</span>'}
        </header>
        <div class="rd-job-to">
          <span class="rd-pin" aria-hidden="true">📍</span>
          <div>
            <strong>${escapeHtml(job.address)}</strong>
            <small>${escapeHtml(job.customerName)}${job.destination ? ' · live location shared' : ''}</small>
          </div>
        </div>
        <ul class="rd-items">${job.items.map((item) => `<li><b>${item.quantity}×</b> ${escapeHtml(item.name)}</li>`).join('')}</ul>
        ${job.note ? `<p class="rd-note">📝 ${escapeHtml(job.note)}</p>` : ''}
        ${job.mine ? `<div class="rd-contact">
          <a href="tel:${escapeHtml(phone)}">📞 Call</a>
          <a href="https://wa.me/${escapeHtml(whatsapp)}" target="_blank" rel="noopener">💬 WhatsApp</a>
          <a href="${directionsUrl(job)}" target="_blank" rel="noopener">🗺️ Map</a>
        </div>` : ''}
        <div class="rd-actions">${actions(job)}</div>
      </article>`;
  }

  function render() {
    $('rd-count-mine').textContent = data.mine.length;
    $('rd-count-available').textContent = data.available.length;
    $('rd-stat-active').textContent = data.mine.length;
    const list = tab === 'mine' ? data.mine : data.available;
    if (!list.length) {
      listEl.innerHTML = tab === 'mine'
        ? `<div class="rd-empty"><span>🛵</span><strong>No deliveries yet</strong><p>${data.available.length ? `There ${data.available.length === 1 ? 'is 1 new order' : `are ${data.available.length} new orders`} waiting.` : 'New orders appear here as soon as students order delivery.'}</p>${data.available.length ? '<button type="button" class="rd-btn rd-btn--primary" data-goto="available">See new orders</button>' : ''}</div>`
        : '<div class="rd-empty"><span>✅</span><strong>All caught up</strong><p>No delivery orders are waiting. We will chime when one comes in.</p></div>';
      return;
    }
    listEl.innerHTML = list.map(card).join('');
  }

  async function load() {
    try {
      const result = await api('/api/rider/jobs');
      data = result;
      $('rd-name').textContent = `${result.rider.name || 'Kitchen staff'}${result.rider.role !== 'rider' ? ` · ${result.rider.role}` : ''}`;
      $('rd-stat-done').textContent = result.deliveredToday;
      $('rd-stat-fees').textContent = money(result.feesToday);
      const ids = new Set(result.available.map((job) => job.id));
      if (knownAvailable && [...ids].some((id) => !knownAvailable.has(id))) {
        chime();
        say('🔔 New delivery order!', 'good');
        document.title = '🔔 New order | Kitchen Rider';
        setTimeout(() => { document.title = 'Rider | THE KITCHEN'; }, 8000);
      }
      knownAvailable = ids;
      render();
    } catch (error) {
      say(error.message, 'error');
    }
  }

  // ---------- Location sharing ----------
  async function sendPosition(position) {
    const now = Date.now();
    if (now - lastSent < 8000) return;
    lastSent = now;
    try {
      await api('/api/rider/location', { method: 'POST', body: JSON.stringify({ lat: position.coords.latitude, lng: position.coords.longitude }) });
      $('rd-online-help').textContent = `Sharing live location · accurate to ${Math.round(position.coords.accuracy)} m · updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      $('rd-online-help').textContent = 'Could not send your location. Check your internet connection.';
    }
  }

  async function goOnline() {
    if (!('geolocation' in navigator)) {
      onlineInput.checked = false;
      say('This phone cannot share location.', 'error');
      return;
    }
    watchId = navigator.geolocation.watchPosition(sendPosition, (error) => {
      $('rd-online-help').textContent = error.code === error.PERMISSION_DENIED
        ? 'Location permission is off. Allow location for this site in your phone settings.'
        : 'Looking for GPS signal…';
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      wakeLock = null;
    }
    document.body.classList.add('is-online');
    $('rd-online-label').textContent = 'You are online';
    $('rd-online-help').textContent = 'Finding your location…';
    try { localStorage.setItem('riderOnline', '1'); } catch { /* optional */ }
  }

  function goOffline() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
    document.body.classList.remove('is-online');
    $('rd-online-label').textContent = 'You are offline';
    $('rd-online-help').textContent = 'Go online to share your location with students while you deliver.';
    try { localStorage.removeItem('riderOnline'); } catch { /* optional */ }
  }

  onlineInput.addEventListener('change', () => (onlineInput.checked ? goOnline() : goOffline()));
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && watchId !== null && 'wakeLock' in navigator && !wakeLock) {
      try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* optional */ }
    }
    if (document.visibilityState === 'visible') load();
  });

  // ---------- Actions ----------
  async function act(action, id) {
    if (busy) return;
    busy = true;
    try {
      const result = await api(`/api/rider/jobs/${id}/${action}`, { method: 'POST', body: '{}' });
      say(result.message, 'good');
      if (action === 'accept') tab = 'mine';
      if (action === 'pickup' && !onlineInput.checked) {
        onlineInput.checked = true;
        await goOnline();
      }
      selectTab(tab);
      await load();
    } catch (error) {
      say(error.message, 'error');
      await load();
    } finally {
      busy = false;
    }
  }

  function openCode(id) {
    codeOrderId = id;
    codeInput.value = '';
    codeError.textContent = '';
    codeDialog.showModal();
    setTimeout(() => codeInput.focus(), 50);
  }

  // One field for the whole code: digits only, at most 4.
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 4);
    codeError.textContent = '';
  });

  $('rd-code-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = codeInput.value.replace(/\D/g, '');
    if (code.length !== 4) {
      codeError.textContent = 'Enter all 4 digits.';
      return;
    }
    const submit = $('rd-code-submit');
    submit.disabled = true;
    try {
      const result = await api(`/api/rider/jobs/${codeOrderId}/deliver`, { method: 'POST', body: JSON.stringify({ code }) });
      codeDialog.close();
      say(`🎉 ${result.message}`, 'good');
      if (navigator.vibrate) navigator.vibrate(120);
      await load();
    } catch (error) {
      codeError.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  $('rd-code-cancel').addEventListener('click', () => codeDialog.close());

  listEl.addEventListener('click', (event) => {
    const goto = event.target.closest('[data-goto]');
    if (goto) {
      selectTab(goto.dataset.goto);
      return;
    }
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const id = Number(button.dataset.id);
    if (button.dataset.act === 'deliver') openCode(id);
    else if (button.dataset.act === 'release') {
      if (window.confirm(`Release order #${id} so another rider can take it?`)) act('release', id);
    } else act(button.dataset.act, id);
  });

  function selectTab(name) {
    tab = name;
    document.querySelectorAll('.rd-tab').forEach((button) => {
      const active = button.dataset.tab === name;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    render();
  }
  document.querySelectorAll('.rd-tab').forEach((button) => button.addEventListener('click', () => selectTab(button.dataset.tab)));

  $('rd-logout').addEventListener('click', async () => {
    goOffline();
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch { /* ignore */ }
    try { localStorage.removeItem('foodieUser'); } catch { /* ignore */ }
    window.location.href = 'login.html';
  });

  load();
  setInterval(load, 8000);
  try {
    if (localStorage.getItem('riderOnline') === '1') {
      onlineInput.checked = true;
      goOnline();
    }
  } catch { /* optional */ }
})();
