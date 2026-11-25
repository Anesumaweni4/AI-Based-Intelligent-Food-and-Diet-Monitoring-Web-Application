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
  let aiReady = null; // null = not checked yet, false = no AI key on the server
  let picked = [];    // foods chosen by hand when the AI is not available

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
      if (aiReady === false) {
        await renderPicker();
        return;
      }
      captionEl.textContent = 'AI is looking at your meal…';
      showStage('scanning');
      try {
        current = await api('/api/diet/scan', {
          method: 'POST',
          body: JSON.stringify({ image, note: noteInput.value.trim() })
        });
      } catch (error) {
        // No AI key on the server: carry on with the quick picker instead.
        if (error.status === 503) {
          aiReady = false;
          await renderPicker();
          return;
        }
        throw error;
      }
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
    resultEl.onclick = null;
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

  // ---------------------------------------------------------------------------
  // Quick picker: used when the AI is not set up. The photo is kept as a
  // reminder and the student taps the foods on the plate.
  // ---------------------------------------------------------------------------
  const POPULAR = ['sadza', 'beef stew', 'chicken', 'rice', 'chips', 'covo', 'beans', 'bread', 'egg', 'coke'];
  const PORTIONS = [['0.5', '½'], ['1', '1'], ['1.5', '1½'], ['2', '2']];
  let foodCache = null;

  async function loadFoods() {
    if (foodCache) return foodCache;
    let data = (typeof dietData !== 'undefined' && dietData) ? dietData : null;
    if (!data || !data.foods) data = await api('/api/diet');
    foodCache = [
      ...(data.foods || []).map((food) => ({ ...food, ref: `menu:${food.id}`, from: 'Kitchen menu' })),
      ...(data.outsideFoods || []).map((food) => ({ ...food, ref: `outside:${food.key}`, from: 'Common food' }))
    ];
    return foodCache;
  }

  function findFoods(query) {
    const text = query.trim().toLowerCase();
    if (!text) return [];
    return foodCache
      .filter((food) => food.name.toLowerCase().includes(text))
      .sort((a, b) => a.name.toLowerCase().indexOf(text) - b.name.toLowerCase().indexOf(text))
      .slice(0, 8);
  }

  function popularFoods() {
    const chosen = [];
    for (const word of POPULAR) {
      const food = foodCache.find((item) => item.name.toLowerCase().includes(word) && !chosen.includes(item));
      if (food) chosen.push(food);
    }
    return chosen.slice(0, 8);
  }

  function pickedTotals() {
    return picked.reduce((sum, entry) => {
      for (const key of ['calories', 'protein', 'fiber', 'sugar']) sum[key] += (Number(entry.food[key]) || 0) * entry.servings;
      return sum;
    }, { calories: 0, protein: 0, fiber: 0, sugar: 0 });
  }

  function addPicked(ref) {
    const food = foodCache.find((item) => item.ref === ref);
    if (!food) return;
    const existing = picked.find((entry) => entry.food.ref === ref);
    if (existing) existing.servings = Math.min(3, existing.servings + 0.5);
    else picked.push({ food, servings: 1 });
    drawPicker();
  }

  function drawPicker() {
    const list = resultEl.querySelector('#aisc-picked');
    const chips = resultEl.querySelector('#aisc-popular');
    const totals = pickedTotals();
    chips.innerHTML = popularFoods().map((food) => `
      <button type="button" class="aisc-pick-chip${picked.some((entry) => entry.food.ref === food.ref) ? ' is-on' : ''}" data-pick="${escapeHtml(food.ref)}">${escapeHtml(food.name)}</button>`).join('');
    list.innerHTML = picked.length ? picked.map((entry, index) => `
      <li>
        <span class="aisc-item-main">
          <strong>${escapeHtml(entry.food.name)}</strong>
          <small>${round(entry.food.calories * entry.servings)} kcal · ${round(entry.food.protein * entry.servings, 1)} g protein</small>
        </span>
        <span class="aisc-portions" role="group" aria-label="Servings of ${escapeHtml(entry.food.name)}">
          ${PORTIONS.map(([value, label]) => `<button type="button" data-portion="${index}" data-value="${value}" aria-pressed="${Number(value) === entry.servings}">${label}</button>`).join('')}
        </span>
        <button type="button" class="aisc-remove" data-remove="${index}" aria-label="Remove ${escapeHtml(entry.food.name)}">×</button>
      </li>`).join('') : '<li class="aisc-picked-empty">Tap the foods on your plate, or search above.</li>';
    resultEl.querySelector('[data-total="calories"]').textContent = round(totals.calories);
    resultEl.querySelector('[data-total="protein"]').textContent = round(totals.protein, 1);
    resultEl.querySelector('[data-total="fiber"]').textContent = round(totals.fiber, 1);
    resultEl.querySelector('[data-total="sugar"]').textContent = round(totals.sugar, 1);
    const addButton = resultEl.querySelector('#aisc-add');
    addButton.disabled = picked.length === 0;
    addButton.textContent = picked.length ? `Add ${picked.length} food${picked.length === 1 ? '' : 's'} to my diary` : 'Choose a food to add';
    captionEl.textContent = picked.length ? `${picked.length} food${picked.length === 1 ? '' : 's'} chosen` : 'Your meal';
  }

  async function renderPicker() {
    await loadFoods();
    picked = [];
    showStage('result');
    const slot = defaultSlot();
    resultEl.innerHTML = `
      <div class="aisc-result-head">
        <div>
          <p class="aisc-kicker">Quick log</p>
          <h4>What's on your plate?</h4>
        </div>
      </div>
      <label class="aisc-find">
        <span class="aisc-sr">Search foods</span>
        <input type="search" id="aisc-find" placeholder="Search foods, e.g. sadza" autocomplete="off" />
      </label>
      <div class="aisc-find-results" id="aisc-find-results"></div>
      <p class="aisc-pick-label">Popular</p>
      <div class="aisc-pick-chips" id="aisc-popular"></div>
      <ul class="aisc-items aisc-picked" id="aisc-picked"></ul>
      <div class="aisc-totals">
        <div><strong data-total="calories"></strong><span>kcal</span></div>
        <div><strong data-total="protein"></strong><span>g protein</span></div>
        <div><strong data-total="fiber"></strong><span>g fibre</span></div>
        <div><strong data-total="sugar"></strong><span>g sugar</span></div>
      </div>
      <div class="aisc-controls">
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
      <p class="aisc-disclaimer">Nutrition comes from the kitchen's recipes and standard food tables.</p>`;

    const find = resultEl.querySelector('#aisc-find');
    const results = resultEl.querySelector('#aisc-find-results');
    find.addEventListener('input', () => {
      results.innerHTML = findFoods(find.value).map((food) => `
        <button type="button" data-pick="${escapeHtml(food.ref)}"><strong>${escapeHtml(food.name)}</strong><small>${round(food.calories)} kcal · ${food.from}</small></button>`).join('')
        || (find.value.trim() ? '<p class="aisc-find-none">No match. Try another word.</p>' : '');
    });
    resultEl.onclick = onPickerClick;
    resultEl.querySelector('#aisc-retake').addEventListener('click', () => cameraInput.click());
    resultEl.querySelector('#aisc-add').addEventListener('click', addPickedToDiary);
    drawPicker();
    setStatus('Tap the foods in your photo to add them to your diary.', 'info');
  }

  function onPickerClick(event) {
    const pick = event.target.closest('[data-pick]');
    if (pick) {
      addPicked(pick.dataset.pick);
      const find = resultEl.querySelector('#aisc-find');
      if (find && pick.closest('#aisc-find-results')) {
        find.value = '';
        resultEl.querySelector('#aisc-find-results').innerHTML = '';
      }
      return;
    }
    const portion = event.target.closest('[data-portion]');
    if (portion) {
      picked[Number(portion.dataset.portion)].servings = Number(portion.dataset.value);
      drawPicker();
      return;
    }
    const remove = event.target.closest('[data-remove]');
    if (remove) {
      picked.splice(Number(remove.dataset.remove), 1);
      drawPicker();
    }
  }

  async function addPickedToDiary() {
    const button = resultEl.querySelector('#aisc-add');
    button.disabled = true;
    const slot = resultEl.querySelector('#aisc-slot').value;
    try {
      for (const entry of picked) {
        const payload = { servings: entry.servings, slot, day: 'today' };
        if (entry.food.ref.startsWith('menu:')) payload.menuItemId = Number(entry.food.id);
        else payload.foodKey = entry.food.key;
        await api('/api/diet/meals', { method: 'POST', body: JSON.stringify(payload) });
      }
      const count = picked.length;
      picked = [];
      resultEl.onclick = null;
      noteInput.value = '';
      previewEl.removeAttribute('src');
      showStage('empty');
      setStatus(`✓ Added ${count} food${count === 1 ? '' : 's'} to your diary.`, 'good');
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
    aiReady = Boolean(info.configured);
    if (!info.configured) {
      // Still usable: take the photo, then tap the foods on the plate.
      const title = document.getElementById('aisc-title');
      const lead = card.querySelector('.aisc-lead');
      if (title) title.textContent = 'Snap your plate. Log it in seconds.';
      if (lead) lead.textContent = 'Take a photo of any meal, from the kitchen, home or the market, then tap the foods on your plate. Calories, protein, fibre and sugar are added to your diary for you.';
      setStatus('Take a photo of your meal, then tap the foods on your plate.', 'info');
    } else {
      setStatus(`${info.scansLeft} of ${info.dailyLimit} scans left today.`);
    }
  }).catch(() => {});
})();
