const feedbackChatToggle = document.getElementById('feedback-chat-toggle');
const feedbackChatPanel = document.getElementById('feedback-chat-panel');
const feedbackChatMessages = document.getElementById('feedback-chat-messages');
const feedbackChatCategories = document.getElementById('feedback-chat-categories');
const feedbackChatForm = document.getElementById('feedback-chat-form');
const feedbackChatInput = document.getElementById('feedback-chat-input');
const feedbackChatStatus = document.getElementById('feedback-chat-status');
const feedbackCategoryLabels = {
  food: 'Food',
  order: 'My order',
  service: 'Service',
  website: 'Website',
  other: 'Something else'
};
let selectedFeedbackCategory = '';
let feedbackSending = false;
let feedbackHistoryLoaded = false;

function escapeFeedbackHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function appendFeedbackMessage(text, author, meta = '') {
  const message = document.createElement('div');
  message.className = `feedback-chat-message ${author === 'client' ? 'client' : 'assistant'}`;
  message.innerHTML = `
    <p>${escapeFeedbackHtml(text)}</p>
    ${meta ? `<span>${escapeFeedbackHtml(meta)}</span>` : ''}
  `;
  feedbackChatMessages.appendChild(message);
  feedbackChatMessages.scrollTop = feedbackChatMessages.scrollHeight;
}

function showFeedbackCategories() {
  selectedFeedbackCategory = '';
  feedbackChatForm.hidden = true;
  feedbackChatCategories.hidden = false;
}

async function readFeedbackResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error('Feedback is not available yet. Please restart the app, then refresh this page.');
  }
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.location.href = 'login.html';
    throw new Error(result.message || 'Unable to complete your feedback request.');
  }
  return result;
}

async function loadFeedbackHistory() {
  const response = await fetch('/api/feedback');
  const entries = await readFeedbackResponse(response);
  if (entries.length) {
    for (const entry of entries.slice().reverse()) {
      appendFeedbackMessage(
        `${feedbackCategoryLabels[entry.category] || 'Feedback'}: ${entry.message}`,
        'client',
        new Date(entry.created_at).toLocaleString()
      );
      appendFeedbackMessage(`Your feedback is ${entry.status}. Thank you for sharing it.`, 'assistant');
    }
  }
  feedbackHistoryLoaded = true;
}

feedbackChatToggle.addEventListener('click', async () => {
  feedbackChatPanel.hidden = !feedbackChatPanel.hidden;
  feedbackChatToggle.setAttribute('aria-expanded', String(!feedbackChatPanel.hidden));
  if (feedbackChatPanel.hidden) return;
  if (!feedbackHistoryLoaded) {
    try {
      await loadFeedbackHistory();
    } catch (error) {
      feedbackChatStatus.textContent = error.message;
      feedbackChatStatus.classList.add('error');
    }
    if (!feedbackChatMessages.childElementCount) {
      appendFeedbackMessage('Hi! I can pass your feedback to the team. What would you like to talk about?', 'assistant');
    }
    showFeedbackCategories();
  }
});

document.getElementById('feedback-chat-close').addEventListener('click', () => {
  feedbackChatPanel.hidden = true;
  feedbackChatToggle.setAttribute('aria-expanded', 'false');
  feedbackChatToggle.focus();
});

feedbackChatCategories.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-feedback-category]');
  if (!button) return;
  selectedFeedbackCategory = button.dataset.feedbackCategory;
  feedbackChatStatus.textContent = '';
  feedbackChatStatus.classList.remove('error');
  appendFeedbackMessage(feedbackCategoryLabels[selectedFeedbackCategory], 'client');
  appendFeedbackMessage(`Please tell us what happened or what we could improve about ${feedbackCategoryLabels[selectedFeedbackCategory].toLowerCase()}.`, 'assistant');
  feedbackChatCategories.hidden = true;
  feedbackChatForm.hidden = false;
  feedbackChatInput.focus();
});

feedbackChatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = feedbackChatInput.value.trim();
  if (!selectedFeedbackCategory || !message || feedbackSending) return;

  feedbackSending = true;
  const submitButton = feedbackChatForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  feedbackChatStatus.textContent = 'Sending your feedback…';
  feedbackChatStatus.classList.remove('error');
  try {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: selectedFeedbackCategory, message })
    });
    const result = await readFeedbackResponse(response);
    appendFeedbackMessage(message, 'client');
    appendFeedbackMessage(result.message, 'assistant');
    feedbackChatForm.reset();
    feedbackChatStatus.textContent = '';
    showFeedbackCategories();
  } catch (error) {
    feedbackChatStatus.textContent = error.message;
    feedbackChatStatus.classList.add('error');
  } finally {
    feedbackSending = false;
    submitButton.disabled = false;
  }
});
