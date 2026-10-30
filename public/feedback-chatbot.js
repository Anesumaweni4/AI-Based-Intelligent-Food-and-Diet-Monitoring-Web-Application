const feedbackChatToggle = document.getElementById('feedback-chat-toggle');
const feedbackChatPanel = document.getElementById('feedback-chat-panel');
const feedbackChatMessages = document.getElementById('feedback-chat-messages');
const feedbackChatCategories = document.getElementById('feedback-chat-categories');
const feedbackChatForm = document.getElementById('feedback-chat-form');
const feedbackChatInput = document.getElementById('feedback-chat-input');
const feedbackChatPhoto = document.getElementById('feedback-chat-photo');
const feedbackPhotoPreview = document.getElementById('feedback-photo-preview');
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
  feedbackPhotoPreview.hidden = true;
  feedbackPhotoPreview.removeAttribute('src');
  if (feedbackPhotoPreviewUrl) URL.revokeObjectURL(feedbackPhotoPreviewUrl);
  feedbackPhotoPreviewUrl = null;
}

async function loadFeedbackHistory() {
  const response = await fetch('/api/feedback');
  const entries = await readFeedbackResponse(response);
  if (entries.length) {
    for (const entry of entries.slice().reverse()) {
      appendFeedbackMessage(
        `${feedbackCategoryLabels[entry.category] || 'Feedback'}: ${entry.message}`,
        'client',
        `${new Date(entry.created_at).toLocaleString()}${entry.has_photo ? ' · Photo attached' : ''}`
      );
      appendFeedbackMessage(`Your feedback is ${entry.status}. Thank you for sharing it.`, 'assistant');
    }
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
    feedbackPhotoPreview.hidden = true;
    feedbackPhotoPreview.removeAttribute('src');
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > MAX_FEEDBACK_PHOTO_SIZE) {
    feedbackChatPhoto.value = '';
    feedbackPhotoPreview.hidden = true;
    feedbackChatStatus.textContent = 'Choose a JPEG, PNG, or WebP photo smaller than 15 MB.';
    feedbackChatStatus.classList.add('error');
    return;
  }
  feedbackPhotoPreviewUrl = URL.createObjectURL(file);
  feedbackPhotoPreview.src = feedbackPhotoPreviewUrl;
  feedbackPhotoPreview.hidden = false;
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
  feedbackChatPhoto.disabled = true;
  feedbackChatStatus.textContent = feedbackChatPhoto.files[0]
    ? 'Preparing and sending your feedback photo…'
    : 'Sending your feedback…';
  feedbackChatStatus.classList.remove('error');
  try {
    const photo = await prepareFeedbackPhoto(feedbackChatPhoto.files[0]);
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: selectedFeedbackCategory, message, photo })
    });
    const result = await readFeedbackResponse(response);
    appendFeedbackMessage(message, 'client', photo ? 'Photo attached' : '');
    appendFeedbackMessage(result.message, 'assistant');
    feedbackChatForm.reset();
    clearFeedbackPhoto();
    feedbackChatStatus.textContent = '';
    showFeedbackCategories();
  } catch (error) {
    feedbackChatStatus.textContent = error.message;
    feedbackChatStatus.classList.add('error');
  } finally {
    feedbackSending = false;
    submitButton.disabled = false;
    feedbackChatPhoto.disabled = false;
  }
});
