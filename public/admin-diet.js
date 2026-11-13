// Admin panel: anonymous diet insights produced by the ML models.
(() => {
  const section = document.getElementById('diet-insights');
  if (!section) return;
  const $ = (id) => document.getElementById(id);
  const status = $('di-status');
  const body = $('di-body');
  let signature = '';
  let loading = false;

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);

  const tone = (score) => (score === null ? 'none' : score >= 70 ? 'good' : score >= 55 ? 'ok' : 'low');

  function render(data) {
    const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
    $('di-stats').innerHTML = [
      ['Students', data.students, 'registered student accounts'],
      ['With insight', data.studentsWithData, 'logged food on 3+ of the last 7 days'],
      ['Logged today', data.loggedToday, `${percent(data.loggedToday, data.students)}% of students`],
      ['Profiles complete', data.profilesComplete, 'age, weight, height and sex set']
    ].map(([label, value, note]) => `
      <div class="di-stat"><span>${label}</span><strong>${value}</strong><small>${escapeHtml(note)}</small></div>`).join('');

    const totalRisk = data.risk.high + data.risk.medium + data.risk.low;
    $('di-risk').innerHTML = totalRisk
      ? ['high', 'medium', 'low'].map((level) => `
          <div class="di-risk-row" data-level="${level}">
            <span>${level === 'high' ? 'High risk' : level === 'medium' ? 'Some risk' : 'Low risk'}</span>
            <div class="di-bar"><i style="width:${percent(data.risk[level], totalRisk)}%"></i></div>
            <b data-risk-count="${level}">${data.risk[level]}</b>
          </div>`).join('')
      : '<p class="di-empty">No student has enough diary data yet (3 logged days in the last week).</p>';

    $('di-concerns').innerHTML = data.studentsWithData
      ? data.concerns.map((concern) => `
          <div class="di-concern">
            <span>${escapeHtml(concern.label)}</span>
            <div class="di-bar"><i style="width:${concern.percent}%"></i></div>
            <b>${concern.percent}%</b>
          </div>`).join('')
      : '<p class="di-empty">Concerns appear once students have logged a few days.</p>';

    const clusterTotal = data.clusters.reduce((sum, cluster) => sum + cluster.students, 0);
    $('di-clusters').innerHTML = data.clusters.map((cluster) => `
      <div class="di-cluster">
        <div class="di-cluster-top">
          <strong>${escapeHtml(cluster.name)}</strong>
          <span>${cluster.students} student${cluster.students === 1 ? '' : 's'}${clusterTotal ? ` · ${percent(cluster.students, clusterTotal)}%` : ''}</span>
        </div>
        <div class="di-bar"><i style="width:${percent(cluster.students, clusterTotal)}%"></i></div>
        <p>${escapeHtml(cluster.description)}</p>
        <p class="di-action"><b>Kitchen idea:</b> ${escapeHtml(cluster.tip)}</p>
      </div>`).join('');

    $('di-days').innerHTML = data.dailyAverages.map((day) => {
      const date = new Date(`${day.date}T12:00:00`);
      const height = day.averageScore === null ? 4 : Math.max(6, Math.round(day.averageScore));
      return `
        <div class="di-day" data-tone="${tone(day.averageScore)}">
          <b>${day.averageScore === null ? '—' : Math.round(day.averageScore)}</b>
          <div class="di-day-track"><i style="height:${height}%"></i></div>
          <span>${date.toLocaleDateString(undefined, { weekday: 'short' })}</span>
          <small>${day.students} logged</small>
        </div>`;
    }).join('');

    const model = data.model;
    $('di-model').innerHTML = model.loaded ? `
      <dl>
        <div><dt>Eating patterns</dt><dd>K-means, k = ${model.clustering.k} (silhouette ${model.clustering.silhouette})</dd></div>
        <div><dt>Early warning</dt><dd>${escapeHtml(model.risk.algorithm)}</dd></div>
        <div><dt>Test accuracy</dt><dd>${Math.round(model.risk.metrics.accuracy * 100)}%</dd></div>
        <div><dt>ROC AUC</dt><dd>${model.risk.metrics.rocAuc}</dd></div>
        <div><dt>Recall (at-risk caught)</dt><dd>${Math.round(model.risk.metrics.recall * 100)}%</dd></div>
        <div><dt>Training data</dt><dd>${model.dataset.students} simulated students × ${model.dataset.days} days</dd></div>
        <div><dt>Trained</dt><dd>${new Date(model.trainedAt).toLocaleDateString()}</dd></div>
      </dl>
      <p class="di-muted">Retrain with <code>npm run ml:train</code>. Guidance only, not medical diagnosis.</p>`
      : '<p class="di-empty">Models are not loaded on the server. Run <code>npm run ml:train</code>.</p>';
  }

  async function load({ quiet = false } = {}) {
    if (loading) return;
    loading = true;
    if (!quiet) status.textContent = 'Loading diet insights…';
    try {
      const response = await fetch('/api/admin/diet-insights');
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to load diet insights.');
      const { generatedAt, ...rest } = data;
      const next = JSON.stringify(rest);
      if (next !== signature) {
        signature = next;
        render(data);
      }
      body.hidden = false;
      status.textContent = `Updated ${new Date(generatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
      status.classList.remove('is-error');
    } catch (error) {
      status.textContent = error.message;
      status.classList.add('is-error');
    } finally {
      loading = false;
    }
  }

  $('di-refresh').addEventListener('click', () => load());
  load();
  setInterval(() => {
    if (!section.hidden && !document.hidden) load({ quiet: true });
  }, 60000);
  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#diet-insights') load({ quiet: true });
  });
})();
