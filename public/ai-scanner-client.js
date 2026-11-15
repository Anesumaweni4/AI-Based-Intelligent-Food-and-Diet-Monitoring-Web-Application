// AI meal photo scanner card on the Diet page.
(() => {
  const card = document.getElementById('ai-scanner');
  if (!card) return;

  const statusEl = document.getElementById('aisc-status');
  const cameraInput = document.getElementById('aisc-camera');
  const galleryInput = document.getElementById('aisc-gallery');
  const noteInput = document.getElementById('aisc-note');
  const emptyEl = document.getElementById('aisc-empty');
  const photoEl = document.getElementById('aisc-photo');
  const previewEl = document.getElementById('aisc-preview');
  const captionEl = document.getElementById('aisc-caption');
  const resultEl = document.getElementById('aisc-result');

  const BALANCE = {
    balanced: ['Balanced plate', 'good'],
    needs_vegetables: ['Add vegetables', 'warn'],
    needs_protein: ['Add protein', 'warn'],
    high_fat: ['High in fat', 'warn'],
    high_sugar: ['High in sugar', 'warn'],
    light_snack: ['Light snack', 'info'],
    not_food: ['No food found', 'warn']
  };
  const SLOTS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['supper', 'Supper'], ['snack', 'Snack'], ['late', 'Late night']];

  let busy = false;
  let current = null;

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const round = (value, digits = 0) => {
    const factor = 10 ** digits;
    return Math.round(Number(value) * factor) / factor;
  };

  function setStatus(message, tone = '') {
    statusEl.textContent = message || '';
    statusEl.dataset.tone = tone;
  }

  function defaultSlot() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 10) return 'breakfast';
    if (hour >= 10 && hour < 15) return 'lunch';
    if (hour >= 15 && hour < 17) return 'snack';
    if (hour >= 17 && hour < 21) return 'supper';
    return 'late';
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) window.location.href = 'login.html';
      const error = new Error(result.message || 'Something went wrong. Please try again.');
      error.status = response.status;
      throw error;
    }
    return result;
  }

  // Shrink the photo in the browser: faster upload, lower AI cost, same accuracy.
  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        reject(new Error('Please choose a photo.'));
        return;
      }
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('This photo format cannot be opened here. Please take a new photo or choose a JPEG.'));
      };
      image.src = url;
    });
  }

  function showStage(stage) {
    emptyEl.hidden = stage !== 'empty';
    photoEl.hidden = stage === 'empty';
    resultEl.hidden = stage !== 'result';
    photoEl.classList.toggle('is-scanning', stage === 'scanning');
  }

  async function handleFile(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file || busy) return;
    busy = true;
    card.classList.add('is-busy');
    setStatus('');
    try {
      const image = await shrinkPhoto(file);
      previewEl.src = image;
      captionEl.textContent = 'AI is looking at your meal…';
      showStage('scanning');
      current = await api('/api/diet/scan', {
        method: 'POST',
        body: JSON.stringify({ image, note: noteInput.value.trim() })
      });
      renderResult();
    } catch (error) {
      showStage(previewEl.src ? 'photo' : 'empty');
      captionEl.textContent = 'Not scanned';
      setStatus(error.message, 'error');
    } finally {
      busy = false;
      card.classList.remove('is-busy');
    }
  }

  function selectedTotals() {
    const servings = Number(resultEl.querySelector('[name="aisc-servings"]:checked')?.value || 1);
    const checked = Array.from(resultEl.querySelectorAll('[data-item]:checked')).map((box) => current.items[Number(box.dataset.item)]);
    const totals = checked.reduce((sum, item) => {
      for (const key of ['calories', 'protein', 'fiber', 'sugar']) sum[key] += item[key] * servings;
      return sum;
    }, { calories: 0, protein: 0, fiber: 0, sugar: 0 });
    return { totals, count: checked.length };
  }

  function updateTotals() {
    const { totals, count } = selectedTotals();
    resultEl.querySelector('[data-total="calories"]').textContent = round(totals.calories);
    resultEl.querySelector('[data-total="protein"]').textContent = round(totals.protein, 1);
    resultEl.querySelector('[data-total="fiber"]').textContent = round(totals.fiber, 1);
    resultEl.querySelector('[data-total="sugar"]').textContent = round(totals.sugar, 1);
    const addButton = resultEl.querySelector('#aisc-add');
    addButton.disabled = count === 0;
    addButton.textContent = count ? `Add ${count} food${count === 1 ? '' : 's'} to my diary` : 'Choose a food to add';
  }

  function renderResult() {
    const [balanceLabel, balanceTone] = BALANCE[current.balance] || BALANCE.balanced;
    captionEl.textContent = current.isFood ? `Found ${current.items.length} food${current.items.length === 1 ? '' : 's'}` : 'No food found';
    showStage('result');

    if (!current.isFood) {
      resultEl.innerHTML = `
        <div class="aisc-nofood">
          <strong>We couldn't find food in this photo.</strong>
          <p>${escapeHtml(current.tip || 'Try again with the whole plate in the picture and good light.')}</p>
        </div>`;
      setStatus(`${current.scansLeft} scans left today.`);
      return;
    }

    const slot = defaultSlot();
    resultEl.innerHTML = `
      <div class="aisc-result-head">
        <div>
          <p class="aisc-kicker">AI result</p>
          <h4>${escapeHtml(current.mealName)}</h4>
        </div>
        <span class="aisc-balance aisc-balance--${balanceTone}">${balanceLabel}</span>
      </div>
      <div class="aisc-totals">
        <div><strong data-total="calories"></strong><span>kcal</span></div>
        <div><strong data-total="protein"></strong><span>g protein</span></div>
        <div><strong data-total="fiber"></strong><span>g fibre</span></div>
        <div><strong data-total="sugar"></strong><span>g sugar</span></div>
      </div>
      <ul class="aisc-items">
        ${current.items.map((item, index) => `
          <li>
            <label>
              <input type="checkbox" data-item="${index}" checked />
              <span class="aisc-check" aria-hidden="true"></span>
              <span class="aisc-item-main">
                <strong>${escapeHtml(item.name)}</strong>
                <small>${escapeHtml(item.portion)}${item.grams ? ` · about ${item.grams} g` : ''} · ${round(item.protein, 1)} g protein</small>
              </span>
              <span class="aisc-item-kcal">${item.calories} kcal</span>
              <span class="aisc-conf aisc-conf--${item.confidence}" title="How sure the AI is">${item.confidence === 'high' ? 'Sure' : item.confidence === 'medium' ? 'Likely' : 'Unsure'}</span>
            </label>
          </li>`).join('')}
      </ul>
      ${current.tip ? `<p class="aisc-tip"><span aria-hidden="true">💡</span> ${escapeHtml(current.tip)}</p>` : ''}
      ${current.notes ? `<p class="aisc-notes">${escapeHtml(current.notes)}</p>` : ''}
      <div class="aisc-controls">
        <fieldset class="aisc-seg">
          <legend>How much did you eat?</legend>
          ${[['0.5', 'Half'], ['1', 'All of it'], ['1.5', '1½ plates'], ['2', '2 plates']].map(([value, label]) => `
            <label><input type="radio" name="aisc-servings" value="${value}" ${value === '1' ? 'checked' : ''} /><span>${label}</span></label>`).join('')}
        </fieldset>
        <label class="aisc-slot">
          <span>Meal</span>
          <select id="aisc-slot">
            ${SLOTS.map(([value, label]) => `<option value="${value}" ${value === slot ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="aisc-result-actions">
        <button type="button" class="aisc-btn aisc-btn--primary" id="aisc-add">Add to my diary</button>
        <button type="button" class="aisc-btn aisc-btn--ghost" id="aisc-retake">Retake</button>
      </div>
      <p class="aisc-disclaimer">AI estimates can be off by 20% or more. Untick anything it got wrong.</p>`;

    resultEl.querySelectorAll('[data-item], [name="aisc-servings"]').forEach((input) => input.addEventListener('change', updateTotals));
    resultEl.querySelector('#aisc-retake').addEventListener('click', () => cameraInput.click());
    resultEl.querySelector('#aisc-add').addEventListener('click', addToDiary);
    updateTotals();
    setStatus(`${current.scansLeft} scans left today.`);
  }

  async function addToDiary() {
    const button = resultEl.querySelector('#aisc-add');
    button.disabled = true;
    try {
      const result = await api('/api/diet/scan/log', {
        method: 'POST',
        body: JSON.stringify({
          scanId: current.scanId,
          items: Array.from(resultEl.querySelectorAll('[data-item]:checked')).map((box) => Number(box.dataset.item)),
          servings: Number(resultEl.querySelector('[name="aisc-servings"]:checked').value),
          slot: resultEl.querySelector('#aisc-slot').value,
          day: 'today'
        })
      });
      current = null;
      noteInput.value = '';
      previewEl.removeAttribute('src');
      showStage('empty');
      setStatus(`✓ ${result.message}`, 'good');
      if (typeof window.loadDietData === 'function') await window.loadDietData();
    } catch (error) {
      setStatus(error.message, 'error');
      button.disabled = false;
    }
  }

  cameraInput.addEventListener('change', () => handleFile(cameraInput));
  galleryInput.addEventListener('change', () => handleFile(galleryInput));

  // Drag and drop a photo on desktop
  card.addEventListener('dragover', (event) => {
    event.preventDefault();
    card.classList.add('is-dragging');
  });
  card.addEventListener('dragleave', () => card.classList.remove('is-dragging'));
  card.addEventListener('drop', (event) => {
    event.preventDefault();
    card.classList.remove('is-dragging');
    if (event.dataTransfer.files.length) handleFile({ files: event.dataTransfer.files, set value(v) {} });
  });

  showStage('empty');
  api('/api/diet/scan').then((info) => {
    if (!info.configured) {
      card.classList.add('is-disabled');
      card.querySelectorAll('input[type="file"]').forEach((input) => { input.disabled = true; });
      setStatus('The AI scanner is being set up by the admin. It will be available soon.', 'info');
    } else {
      setStatus(`${info.scansLeft} of ${info.dailyLimit} scans left today.`);
    }
  }).catch(() => {});
})();
