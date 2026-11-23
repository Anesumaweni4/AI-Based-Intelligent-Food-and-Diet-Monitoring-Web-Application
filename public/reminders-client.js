// Phone reminders card on the Diet page: turns Web Push notifications on or
// off for this phone and saves the student's reminder times.
(() => {
  const card = document.getElementById('dm-reminders');
  if (!card) return;

  const statusEl = document.getElementById('rm-status');
  const messageEl = document.getElementById('rm-message');
  const actionsEl = document.getElementById('rm-actions');
  const iosEl = document.getElementById('rm-ios');
  const devicesEl = document.getElementById('rm-devices');
  const form = document.getElementById('rm-form');
  const formMsg = document.getElementById('rm-form-msg');
  const saveButton = document.getElementById('rm-save');

  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;

  let state = { publicKey: null, devices: [], settings: null };
  let registration = null;
  let subscription = null;
  let busy = false;

  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) window.location.href = 'login.html';
      throw new Error(result.message || 'Something went wrong. Please try again.');
    }
    return result;
  };

  const keyToBytes = (base64) => {
    const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  };

  const sameKey = (sub, publicKey) => {
    try {
      const current = new Uint8Array(sub.options.applicationServerKey || []);
      const wanted = keyToBytes(publicKey);
      return current.length === wanted.length && current.every((byte, index) => byte === wanted[index]);
    } catch {
      return true; // older browsers do not expose the key: assume it matches
    }
  };

  const onThisPhone = () => Boolean(subscription && state.devices.some((device) => device.endpoint === subscription.endpoint));

  function setStatus(text, tone) {
    statusEl.textContent = text;
    statusEl.className = `dm2-pill${tone ? ` dm2-pill--${tone}` : ''}`;
  }

  function button(label, handler, variant = 'primary') {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `dm-btn dm-btn--${variant}`;
    element.textContent = label;
    element.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      actionsEl.querySelectorAll('button').forEach((other) => { other.disabled = true; });
      try {
        await handler();
      } catch (error) {
        messageEl.textContent = error.message || 'Something went wrong. Please try again.';
        messageEl.dataset.tone = 'error';
      } finally {
        busy = false;
        // Keep the message the handler (or the error) just wrote; only unlock the buttons.
        actionsEl.querySelectorAll('button').forEach((other) => { other.disabled = false; });
      }
    });
    return element;
  }

  function renderDevices() {
    const count = state.devices.length;
    if (!count) {
      devicesEl.textContent = '';
      return;
    }
    const names = state.devices.map((device) => device.device);
    devicesEl.textContent = `Reminders go to ${count} device${count === 1 ? '' : 's'}: ${names.join(', ')}.`;
  }

  function render(note) {
    actionsEl.replaceChildren();
    iosEl.hidden = true;
    delete messageEl.dataset.tone;
    renderDevices();

    if (!supported) {
      if (isIOS && !isStandalone) {
        setStatus('Add to Home Screen', 'blue');
        messageEl.textContent = 'On iPhone, notifications work once THE KITCHEN is on your Home Screen (iOS 16.4 or newer). It takes 20 seconds:';
        iosEl.hidden = false;
      } else {
        setStatus('Not supported');
        messageEl.textContent = 'This browser cannot show notifications. On Android use Chrome, Edge, Firefox or Samsung Internet. On iPhone update to iOS 16.4 or newer.';
      }
      return;
    }

    if (Notification.permission === 'denied') {
      setStatus('Blocked');
      messageEl.textContent = isIOS
        ? 'Notifications are blocked. Open Settings → Notifications → The Kitchen and turn on Allow Notifications, then reload this page.'
        : 'Notifications are blocked for this site. Tap the lock icon next to the address, allow Notifications, then reload this page.';
      return;
    }

    if (onThisPhone()) {
      setStatus('On', 'green');
      messageEl.textContent = note || 'Reminders are on for this phone. We only send one when it helps: nothing if you have already eaten, drunk or moved enough.';
      actionsEl.append(
        button('Send a test', sendTest, 'green'),
        button('📊 Weekly summary now', sendWeekly, 'ghost'),
        button('Turn off on this phone', turnOff, 'ghost')
      );
      return;
    }

    setStatus('Off');
    messageEl.textContent = note || 'Get a friendly reminder on your phone at meal times, to drink water and to move. It is free and works even when this site is closed.';
    actionsEl.append(button('🔔 Turn on reminders', turnOn, 'primary'));
  }

  async function ensureRegistration() {
    if (!registration) registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    return registration;
  }

  async function turnOn() {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error(permission === 'denied'
        ? 'Notifications were blocked. You can allow them later in your phone settings.'
        : 'Please tap Allow so THE KITCHEN can send reminders.');
    }
    const reg = await ensureRegistration();
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub, state.publicKey)) {
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(state.publicKey) });
    }
    subscription = sub;
    const result = await api('/api/reminders/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
    state = { ...state, ...result };
    await api('/api/reminders/test', { method: 'POST' }).catch(() => null);
    render('All set! We sent a test notification to this phone. Choose your reminder times on the right.');
  }

  async function turnOff() {
    const endpoint = subscription && subscription.endpoint;
    if (subscription) await subscription.unsubscribe().catch(() => null);
    subscription = null;
    const result = await api('/api/reminders/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) });
    state = { ...state, ...result };
    render('Reminders are off for this phone. You can turn them back on any time.');
  }

  async function sendTest() {
    const result = await api('/api/reminders/test', { method: 'POST' });
    render(`${result.message} It should appear in a few seconds.`);
  }

  async function sendWeekly() {
    const result = await api('/api/reminders/weekly', { method: 'POST' });
    render(`${result.message} It shows how last week compared with the week before.`);
  }

  // ---------- Settings form ----------
  function fillForm(settings) {
    if (!settings) return;
    for (const [name, value] of Object.entries(settings)) {
      const input = form.elements[name];
      if (!input) continue;
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = value;
    }
    syncDisabled();
  }

  function syncDisabled() {
    form.querySelectorAll('.rm-times').forEach((group) => {
      const enabled = form.elements[group.dataset.for].checked;
      group.classList.toggle('is-off', !enabled);
      group.querySelectorAll('input').forEach((input) => { input.disabled = !enabled; });
    });
  }

  form.addEventListener('change', (event) => {
    if (event.target.type === 'checkbox') syncDisabled();
    formMsg.textContent = '';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = {};
    for (const element of form.elements) {
      if (!element.name) continue;
      if (element.type === 'checkbox') body[element.name] = element.checked;
      else if (element.value) body[element.name] = element.value;
    }
    saveButton.disabled = true;
    formMsg.dataset.tone = '';
    try {
      const result = await api('/api/reminders/settings', { method: 'PUT', body: JSON.stringify(body) });
      state.settings = result.settings;
      fillForm(result.settings);
      formMsg.textContent = onThisPhone() ? 'Saved ✓' : 'Saved ✓ Turn on reminders to get them on this phone.';
      formMsg.dataset.tone = 'good';
    } catch (error) {
      formMsg.textContent = error.message;
      formMsg.dataset.tone = 'error';
    } finally {
      saveButton.disabled = false;
    }
  });

  // Live clock on the sample lock screen
  const phoneTime = document.getElementById('rm-phone-time');
  const tickClock = () => {
    phoneTime.textContent = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Harare' }).format(new Date());
  };
  tickClock();
  setInterval(tickClock, 30 * 1000);

  // ---------- Start ----------
  (async () => {
    try {
      state = { ...state, ...(await api('/api/reminders')) };
      fillForm(state.settings);
      if (supported) {
        await ensureRegistration();
        subscription = await registration.pushManager.getSubscription();
        // This phone has a subscription (for example from another student who
        // used it before, or after a reinstall): link it to this account.
        if (subscription && !onThisPhone() && Notification.permission === 'granted' && sameKey(subscription, state.publicKey)) {
          state = { ...state, ...(await api('/api/reminders/subscribe', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) })) };
        }
      }
      render();
    } catch (error) {
      setStatus('Unavailable');
      messageEl.textContent = error.message || 'Reminders are not available right now.';
    }
  })();
})();
