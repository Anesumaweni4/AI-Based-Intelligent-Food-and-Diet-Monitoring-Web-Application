const feedbackChatToggle = document.getElementById('feedback-chat-toggle');
const feedbackChatPanel = document.getElementById('feedback-chat-panel');
const feedbackChatMessages = document.getElementById('feedback-chat-messages');
const feedbackChatCategories = document.getElementById('feedback-chat-categories');
const feedbackChatForm = document.getElementById('feedback-chat-form');
const feedbackChatInput = document.getElementById('feedback-chat-input');
const feedbackChatPhoto = document.getElementById('feedback-chat-photo');
const feedbackPhotoPreview = document.getElementById('feedback-photo-preview');
const feedbackChatStatus = document.getElementById('feedback-chat-status');
const feedbackPhotoWrap = document.getElementById('feedback-photo-wrap');
const feedbackTopicChip = document.getElementById('feedback-topic-chip');
const feedbackCharCount = document.getElementById('feedback-char-count');
const FEEDBACK_STATUS = {
  new: { label: 'Received', tone: 'new' },
  reviewing: { label: 'Being reviewed', tone: 'reviewing' },
  resolved: { label: 'Resolved', tone: 'resolved' }
};
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
let feedbackPhotoPreviewUrl = null;
const MAX_FEEDBACK_PHOTO_SIZE = 15 * 1024 * 1024;
const MAX_COMPRESSED_FEEDBACK_PHOTO_SIZE = 5 * 1024 * 1024;

function escapeFeedbackHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function scrollFeedbackToEnd() {
  feedbackChatMessages.scrollTop = feedbackChatMessages.scrollHeight;
}

function appendFeedbackMessage(text, author, meta = '') {
  const message = document.createElement('div');
  message.className = `fbx-msg fbx-msg--${author === 'client' ? 'client' : 'assistant'}`;
  message.innerHTML = `
    ${author === 'client' ? '' : '<span class="fbx-msg-avatar" aria-hidden="true">K</span>'}
    <div class="fbx-bubble">
      <p>${escapeFeedbackHtml(text)}</p>
      ${meta ? `<span class="fbx-meta">${escapeFeedbackHtml(meta)}</span>` : ''}
    </div>`;
  feedbackChatMessages.appendChild(message);
  scrollFeedbackToEnd();
  return message;
}

function appendFeedbackDivider(text) {
  const divider = document.createElement('div');
  divider.className = 'fbx-divider';
  divider.innerHTML = `<span>${escapeFeedbackHtml(text)}</span>`;
  feedbackChatMessages.appendChild(divider);
}

function formatFeedbackDate(value) {
  const date = new Date(String(value).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(value)) ? '' : 'Z'));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' +
    date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function appendFeedbackTicket(entry) {
  const status = FEEDBACK_STATUS[entry.status] || FEEDBACK_STATUS.new;
  const ticket = document.createElement('div');
  ticket.className = 'fbx-msg fbx-msg--client';
  ticket.innerHTML = `
    <div class="fbx-bubble">
      <span class="fbx-ticket-topic">${escapeFeedbackHtml(feedbackCategoryLabels[entry.category] || 'Feedback')}</span>
      <p>${escapeFeedbackHtml(entry.message)}</p>
      <span class="fbx-meta">${escapeFeedbackHtml(formatFeedbackDate(entry.created_at))}${entry.has_photo ? ' · 📷 Photo' : ''}</span>
    </div>
    <span class="fbx-ticket-status" data-tone="${status.tone}">${status.label}</span>`;
  feedbackChatMessages.appendChild(ticket);
}

function showTyping() {
  const typing = document.createElement('div');
  typing.className = 'fbx-msg fbx-msg--assistant fbx-typing';
  typing.innerHTML = '<span class="fbx-msg-avatar" aria-hidden="true">K</span><div class="fbx-bubble"><i></i><i></i><i></i></div>';
  typing.setAttribute('aria-label', 'Sending');
  feedbackChatMessages.appendChild(typing);
  scrollFeedbackToEnd();
  return typing;
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

async function prepareFeedbackPhoto(file) {
  if (!file) return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }
  if (file.size > MAX_FEEDBACK_PHOTO_SIZE) {
    throw new Error('Choose a photo smaller than 15 MB.');
  }
  if (typeof createImageBitmap !== 'function') {
    throw new Error('This browser cannot prepare the photo. Try a newer browser or a smaller image.');
  }

  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to prepare the photo in this browser.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) throw new Error('Unable to prepare the photo. Please try another image.');
    if (blob.size > MAX_COMPRESSED_FEEDBACK_PHOTO_SIZE) {
      throw new Error('This photo is still too large after compression. Please choose another photo.');
    }

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        if (typeof reader.result !== 'string') {
          reject(new Error('Unable to read the selected photo.'));
          return;
        }
        resolve(reader.result);
      });
      reader.addEventListener('error', () => reject(new Error('Unable to read the selected photo.')));
      reader.readAsDataURL(blob);
    });
  } finally {
    image.close();
  }
}

function clearFeedbackPhoto() {
  feedbackChatPhoto.value = '';
  feedbackPhotoWrap.hidden = true;
  feedbackPhotoPreview.hidden = true;
  feedbackPhotoPreview.removeAttribute('src');
  if (feedbackPhotoPreviewUrl) URL.revokeObjectURL(feedbackPhotoPreviewUrl);
  feedbackPhotoPreviewUrl = null;
}

async function loadFeedbackHistory() {
  const response = await fetch('/api/feedback');
  const entries = await readFeedbackResponse(response);
  if (entries.length) {
    appendFeedbackDivider('Your recent feedback');
    for (const entry of entries.slice().reverse()) appendFeedbackTicket(entry);
    appendFeedbackDivider('New message');
  }
  feedbackHistoryLoaded = true;
}

feedbackChatPhoto.addEventListener('change', () => {
  feedbackChatStatus.textContent = '';
  feedbackChatStatus.classList.remove('error');
  if (feedbackPhotoPreviewUrl) URL.revokeObjectURL(feedbackPhotoPreviewUrl);
  feedbackPhotoPreviewUrl = null;
  const file = feedbackChatPhoto.files[0];
  if (!file) {
    clearFeedbackPhoto();
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > MAX_FEEDBACK_PHOTO_SIZE) {
    clearFeedbackPhoto();
    feedbackChatStatus.textContent = 'Choose a JPEG, PNG, or WebP photo smaller than 15 MB.';
    feedbackChatStatus.classList.add('error');
    return;
  }
  feedbackPhotoPreviewUrl = URL.createObjectURL(file);
  feedbackPhotoPreview.src = feedbackPhotoPreviewUrl;
  feedbackPhotoPreview.hidden = false;
  feedbackPhotoWrap.hidden = false;
});

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
    appendFeedbackMessage('Hi! 👋 Tell us how we are doing. Pick a topic below and your message goes straight to the kitchen team.', 'assistant');
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
  const prompts = {
    food: 'What did you think of the food? Tell us the dish and what was good or not. A photo helps!',
    order: 'What went wrong with your order? Include the order number if you have it.',
    service: 'How was the service? Tell us what happened.',
    website: 'What happened on the website? Which page, and what did you expect?',
    other: 'Go ahead, we are listening.'
  };
  appendFeedbackMessage(prompts[selectedFeedbackCategory], 'assistant');
  feedbackTopicChip.textContent = feedbackCategoryLabels[selectedFeedbackCategory];
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
  feedbackChatPhoto.disabled = true;
  feedbackChatStatus.textContent = feedbackChatPhoto.files[0]
    ? 'Preparing and sending your feedback photo…'
    : 'Sending your feedback…';
  feedbackChatStatus.classList.remove('error');
  let typing = null;
  try {
    const photo = await prepareFeedbackPhoto(feedbackChatPhoto.files[0]);
    typing = showTyping();
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: selectedFeedbackCategory, message, photo })
    });
    const result = await readFeedbackResponse(response);
    typing.remove();
    typing = null;
    appendFeedbackTicket({ category: selectedFeedbackCategory, message, status: 'new', created_at: new Date().toISOString(), has_photo: Boolean(photo) });
    scrollFeedbackToEnd();
    appendFeedbackMessage(`${result.message} You can follow its status here.`, 'assistant');
    feedbackChatForm.reset();
    updateFeedbackComposer();
    clearFeedbackPhoto();
    feedbackChatStatus.textContent = '';
    showFeedbackCategories();
  } catch (error) {
    if (typing) typing.remove();
    feedbackChatStatus.textContent = error.message;
    feedbackChatStatus.classList.add('error');
  } finally {
    feedbackSending = false;
    submitButton.disabled = false;
    feedbackChatPhoto.disabled = false;
  }
});

function updateFeedbackComposer() {
  feedbackChatInput.style.height = 'auto';
  feedbackChatInput.style.height = `${Math.min(feedbackChatInput.scrollHeight, 140)}px`;
  feedbackCharCount.textContent = `${feedbackChatInput.value.length} / 2000`;
}

feedbackChatInput.addEventListener('input', updateFeedbackComposer);
feedbackChatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    feedbackChatForm.requestSubmit();
  }
});
document.getElementById('feedback-photo-remove').addEventListener('click', () => {
  clearFeedbackPhoto();
  feedbackChatInput.focus();
});
document.getElementById('feedback-topic-change').addEventListener('click', () => {
  feedbackChatStatus.textContent = '';
  showFeedbackCategories();
  feedbackChatCategories.querySelector('button').focus();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !feedbackChatPanel.hidden) {
    feedbackChatPanel.hidden = true;
    feedbackChatToggle.setAttribute('aria-expanded', 'false');
    feedbackChatToggle.focus();
  }
});
