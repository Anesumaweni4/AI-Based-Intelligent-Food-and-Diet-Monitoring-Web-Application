// Live order tracking for students: progress steps, the delivery code, and a
// map (OpenStreetMap via Leaflet) showing the rider moving towards them.
(() => {
  const dialog = document.getElementById('track-dialog');
  if (!dialog) return;

  const titleEl = document.getElementById('track-title');
  const eyebrowEl = document.getElementById('track-eyebrow');
  const stepsEl = document.getElementById('track-steps');
  const etaEl = document.getElementById('track-eta');
  const codeBox = document.getElementById('track-code');
  const codeValue = document.getElementById('track-code-value');
  const mapEl = document.getElementById('track-map');
  const mapEmpty = document.getElementById('track-map-empty');

  const STEP_LABELS = {
    Pending: ['Order received', 'Waiting for the kitchen'],
    Preparing: ['Cooking', 'The kitchen is preparing your meal'],
    'Ready for Pickup': ['Packed', 'Ready to collect'],
    'Out for Delivery': ['On the way', 'The rider is coming to you'],
    Delivered: ['Delivered', 'Enjoy your meal!'],
    Collected: ['Collected', 'Enjoy your meal!']
  };

  let leafletPromise = null;
  let map = null;
  let markers = {};
  let line = null;
  let pollTimer = null;
  let currentId = null;
  let fitted = false;

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
      document.head.appendChild(css);
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      script.onload = () => resolve(window.L);
      script.onerror = () => {
        leafletPromise = null;
        reject(new Error('The map could not load. Check your internet connection.'));
      };
      document.head.appendChild(script);
    });
    return leafletPromise;
  }

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function pin(L, emoji, tone) {
    return L.divIcon({
      className: 'track-pin-wrap',
      html: `<span class="track-pin track-pin--${tone}">${emoji}</span>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });
  }

  function renderSteps(data) {
    if (data.status === 'Cancelled') {
      stepsEl.innerHTML = '<li class="is-cancelled"><strong>Cancelled</strong><span>This order was cancelled.</span></li>';
      return;
    }
    const currentIndex = data.steps.indexOf(data.status);
    stepsEl.innerHTML = data.steps.map((step, index) => {
      const [label, detail] = data.orderType === 'delivery' && step === 'Ready for Pickup'
        ? ['Packed', 'Waiting for the rider']
        : STEP_LABELS[step] || [step, ''];
      const state = index < currentIndex ? 'is-done' : index === currentIndex ? 'is-current' : '';
      return `<li class="${state}"><strong>${label}</strong>${state === 'is-current' ? `<span>${detail}</span>` : ''}</li>`;
    }).join('');
  }

  function renderEta(data) {
    if (data.orderType !== 'delivery') {
      etaEl.innerHTML = data.status === 'Ready for Pickup'
        ? '<strong>Ready now</strong><span>Collect it at the kitchen counter.</span>'
        : '<strong>Pickup order</strong><span>We will notify you when it is ready.</span>';
      return;
    }
    if (data.status === 'Out for Delivery') {
      const who = data.rider ? escapeHtml(data.rider.name) : 'Your rider';
      etaEl.innerHTML = data.etaMinutes
        ? `<strong>About ${data.etaMinutes} min</strong><span>${who} is ${data.distanceKm} km away</span>`
        : `<strong>On the way</strong><span>${who} has your order${data.riderLocation ? '' : '. Live location will appear when their phone shares it.'}</span>`;
    } else if (data.status === 'Delivered') {
      etaEl.innerHTML = '<strong>Delivered 🎉</strong><span>Enjoy your meal.</span>';
    } else {
      etaEl.innerHTML = `<strong>${data.status === 'Ready for Pickup' ? 'Packed' : 'In the kitchen'}</strong><span>${data.rider ? `${escapeHtml(data.rider.name)} will bring it to ${escapeHtml(data.address)}` : `Delivering to ${escapeHtml(data.address)}`}</span>`;
    }
  }

  async function renderMap(data) {
    const points = [];
    if (data.kitchen) points.push(['kitchen', data.kitchen]);
    if (data.destination) points.push(['home', data.destination]);
    if (data.riderLocation) points.push(['rider', data.riderLocation]);

    if (!points.length) {
      mapEmpty.hidden = false;
      mapEl.hidden = true;
      mapEmpty.innerHTML = data.orderType === 'delivery'
        ? '<span>🗺️</span><p>The map appears when the rider starts sharing their location.</p>'
        : '<span>🏪</span><p>Pickup order: collect it at the kitchen.</p>';
      return;
    }
    mapEmpty.hidden = true;
    mapEl.hidden = false;

    let L;
    try {
      L = await loadLeaflet();
    } catch (error) {
      mapEmpty.hidden = false;
      mapEl.hidden = true;
      mapEmpty.innerHTML = `<span>⚠️</span><p>${escapeHtml(error.message)}</p>`;
      return;
    }
    if (!map) {
      map = L.map(mapEl, { zoomControl: true, attributionControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);
    }
    const icons = { kitchen: pin(L, '🍳', 'kitchen'), home: pin(L, '🏠', 'home'), rider: pin(L, '🛵', 'rider') };
    const labels = { kitchen: 'THE KITCHEN', home: 'You', rider: data.rider ? data.rider.name : 'Rider' };
    const present = new Set(points.map(([key]) => key));
    for (const key of Object.keys(markers)) {
      if (!present.has(key)) {
        markers[key].remove();
        delete markers[key];
      }
    }
    for (const [key, position] of points) {
      if (markers[key]) markers[key].setLatLng([position.lat, position.lng]);
      else markers[key] = L.marker([position.lat, position.lng], { icon: icons[key], title: labels[key], zIndexOffset: key === 'rider' ? 1000 : 0 }).addTo(map).bindTooltip(labels[key]);
    }
    if (line) line.remove();
    line = data.riderLocation && data.destination
      ? L.polyline([[data.riderLocation.lat, data.riderLocation.lng], [data.destination.lat, data.destination.lng]], { color: '#a24a30', weight: 4, dashArray: '8 8', opacity: 0.8 }).addTo(map)
      : null;
    setTimeout(() => map.invalidateSize(), 50);
    if (!fitted) {
      const bounds = L.latLngBounds(points.map(([, position]) => [position.lat, position.lng]));
      if (points.length === 1) map.setView(bounds.getCenter(), 16);
      else map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
      fitted = true;
    }
  }

  async function refresh() {
    if (!currentId) return;
    try {
      const response = await fetch(`/api/account/orders/${currentId}/track`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to load tracking.');
      titleEl.textContent = `Order #${data.id}`;
      eyebrowEl.textContent = data.orderType === 'delivery' ? 'Live delivery tracking' : 'Order progress';
      renderSteps(data);
      renderEta(data);
      codeBox.hidden = !data.deliveryCode;
      if (data.deliveryCode) codeValue.textContent = data.deliveryCode;
      await renderMap(data);
      if (['Delivered', 'Collected', 'Cancelled'].includes(data.status)) stopPolling();
    } catch (error) {
      etaEl.innerHTML = `<strong>Offline</strong><span>${escapeHtml(error.message)}</span>`;
    }
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  async function openTracking(orderId) {
    currentId = Number(orderId);
    fitted = false;
    if (!dialog.open) dialog.showModal();
    stepsEl.innerHTML = '';
    etaEl.innerHTML = '<strong>Loading…</strong>';
    await refresh();
    stopPolling();
    pollTimer = setInterval(refresh, 5000);
  }

  function closeTracking() {
    stopPolling();
    currentId = null;
    if (dialog.open) dialog.close();
    if (/^#track-\d+$/.test(window.location.hash)) history.replaceState(null, '', window.location.pathname);
  }

  window.openTracking = openTracking;
  document.getElementById('track-close').addEventListener('click', closeTracking);
  dialog.addEventListener('close', () => { stopPolling(); currentId = null; });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) closeTracking(); });
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-track]');
    if (!button) return;
    event.preventDefault();
    openTracking(button.dataset.track);
  });

  const fromHash = /^#track-(\d+)$/.exec(window.location.hash);
  if (fromHash) setTimeout(() => openTracking(fromHash[1]), 600);
})();
