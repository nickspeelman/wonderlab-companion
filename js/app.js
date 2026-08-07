(() => {
  'use strict';

  const config = window.WONDER_LAB_CONFIG;
  const storageKey = 'wonderLabCompanionSession';
  const CROP_SIZE = 600;
  const UPLOAD_SIZE = 900;
  const THUMBNAIL_SIZE = 220;
  const els = {};
  let jsonpCounter = 0;
  let renderingGoogleButton = false;
  let currentUser = null;
  let cropState = null;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    Object.assign(els, {
      status: document.getElementById('status'),
      signinView: document.getElementById('signinView'),
      dashboardView: document.getElementById('dashboardView'),
      errorView: document.getElementById('errorView'),
      googleButton: document.getElementById('googleButton'),
      signoutButton: document.getElementById('signoutButton'),
      profileName: document.getElementById('profileName'),
      profileEmail: document.getElementById('profileEmail'),
      profileImage: document.getElementById('profileImage'),
      pictureUploadForm: document.getElementById('pictureUploadForm'),
      pictureFile: document.getElementById('pictureFile'),
      pictureLabel: document.getElementById('pictureLabel'),
      cropEditor: document.getElementById('cropEditor'),
      cropCanvas: document.getElementById('cropCanvas'),
      cropZoom: document.getElementById('cropZoom'),
      uploadPictureButton: document.getElementById('uploadPictureButton'),
      uploadStatus: document.getElementById('uploadStatus'),
      pictureGrid: document.getElementById('pictureGrid'),
      pictureEmpty: document.getElementById('pictureEmpty'),
    });

    els.signoutButton.addEventListener('click', signOut);
    els.pictureUploadForm.addEventListener('submit', uploadPicture);
    els.pictureFile.addEventListener('change', handlePictureSelection);
    els.cropZoom.addEventListener('input', handleCropZoom);
    els.cropCanvas.addEventListener('pointerdown', beginCropDrag);
    els.cropCanvas.addEventListener('pointermove', moveCropDrag);
    els.cropCanvas.addEventListener('pointerup', endCropDrag);
    els.cropCanvas.addEventListener('pointercancel', endCropDrag);
    els.pictureGrid.addEventListener('click', handlePictureGridClick);

    try {
      validateConfig();
      await callBackend('health');

      const callbackHandled = await handleAuthenticationCallback();
      if (!callbackHandled) {
        await restoreOrShowSignIn();
      }
    } catch (error) {
      showError(error.message);
    }
  }

  function validateConfig() {
    if (
      !config ||
      !config.googleClientId ||
      !config.backendUrl ||
      config.googleClientId.includes('PASTE_') ||
      config.backendUrl.includes('PASTE_')
    ) {
      throw new Error('Complete js/config.js before opening the Companion site.');
    }
  }

  async function handleAuthenticationCallback() {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const code = fragment.get('code');
    const authError = fragment.get('authError');

    if (!code && !authError) return false;

    clearAuthenticationFragment();

    if (authError) throw new Error(authError);

    els.status.textContent = 'Completing sign-in…';
    const result = await callBackend('claimLoginCode', { code });
    localStorage.setItem(storageKey, result.token);
    await showDashboard(result.user);
    return true;
  }

  function clearAuthenticationFragment() {
    const cleanUrl = window.location.pathname + window.location.search;
    window.history.replaceState(null, document.title, cleanUrl);
  }

  async function restoreOrShowSignIn() {
    const token = getSessionToken();
    if (token) {
      try {
        const restored = await callBackend('restoreSession', { sessionToken: token });
        await showDashboard(restored.user);
        return;
      } catch (_) {
        localStorage.removeItem(storageKey);
      }
    }
    await showSignIn();
  }

  async function showSignIn() {
    currentUser = null;
    els.status.textContent = 'Sign in to manage Roscoe’s Wonder Lab.';
    els.signinView.hidden = false;
    els.dashboardView.hidden = true;
    els.errorView.hidden = true;

    if (renderingGoogleButton) return;
    renderingGoogleButton = true;

    try {
      const [login] = await Promise.all([
        callBackend('beginLogin'),
        waitForGoogleIdentity(),
      ]);

      google.accounts.id.initialize({
        client_id: config.googleClientId,
        ux_mode: 'redirect',
        login_uri: config.backendUrl,
        nonce: login.challenge,
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      els.googleButton.replaceChildren();
      google.accounts.id.renderButton(els.googleButton, {
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: 'signin_with',
      });
    } finally {
      renderingGoogleButton = false;
    }
  }

  function waitForGoogleIdentity() {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (window.google && google.accounts && google.accounts.id) {
          clearInterval(timer);
          resolve();
          return;
        }
        if (Date.now() - started > 15000) {
          clearInterval(timer);
          reject(new Error('Google Sign-In did not load.'));
        }
      }, 100);
    });
  }

  function callBackend(action, params = {}) {
    const callbackName = '__wonderLabJsonp' + (++jsonpCounter);
    const url = new URL(config.backendUrl);
    url.searchParams.set('action', action);
    url.searchParams.set('callback', callbackName);

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Wonder Lab backend request timed out.'));
      }, 30000);

      function cleanup() {
        clearTimeout(timeout);
        script.remove();
        try {
          delete window[callbackName];
        } catch (_) {
          window[callbackName] = undefined;
        }
      }

      window[callbackName] = (result) => {
        cleanup();
        if (result && result.ok) resolve(result.payload);
        else reject(new Error(result && result.error ? result.error : 'Wonder Lab backend error.'));
      };

      script.onerror = () => {
        cleanup();
        reject(new Error('Could not reach the Wonder Lab backend.'));
      };

      script.src = url.toString();
      document.head.appendChild(script);
    });
  }

  async function sendCommand(action, fields) {
    const token = getSessionToken();
    if (!token) throw new Error('Your session has ended. Please sign in again.');

    const requestId = createRequestId();
    const body = new URLSearchParams({
      wlAction: action,
      requestId,
      sessionToken: token,
    });

    Object.entries(fields || {}).forEach(([key, value]) => {
      body.set(key, String(value));
    });

    await fetch(config.backendUrl, {
      method: 'POST',
      mode: 'no-cors',
      body,
    });

    return pollCommandResult(requestId, token);
  }

  async function pollCommandResult(requestId, sessionToken) {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      await delay(600);
      const result = await callBackend('claimCommandResult', { requestId, sessionToken });
      if (result.status === 'complete') return result.payload;
    }
    throw new Error('The Wonder Lab operation timed out. It may still have completed.');
  }

  async function showDashboard(user) {
    currentUser = user;
    els.status.textContent = 'Signed in.';
    els.signinView.hidden = true;
    els.dashboardView.hidden = false;
    els.errorView.hidden = true;
    els.profileName.textContent = user.name || 'Wonder Lab caregiver';
    els.profileEmail.textContent = user.email || '';

    if (user.picture) {
      els.profileImage.src = user.picture;
      els.profileImage.hidden = false;
    } else {
      els.profileImage.removeAttribute('src');
      els.profileImage.hidden = true;
    }

    await refreshPictureLibrary();
  }

  async function refreshPictureLibrary() {
    const token = getSessionToken();
    const result = await callBackend('listPictures', { sessionToken: token });
    renderPictures(result.pictures || []);
  }

  function renderPictures(pictures) {
    els.pictureGrid.replaceChildren();
    els.pictureEmpty.hidden = pictures.length !== 0;

    pictures.forEach((picture) => {
      const card = document.createElement('article');
      card.className = 'picture-card';
      card.dataset.pictureId = picture.pictureId;

      const image = document.createElement('img');
      image.alt = picture.label ? `Picture for ${picture.label}` : 'Picture Library image';
      image.loading = 'lazy';
      image.src = picture.thumbnailDataUrl;

      const title = document.createElement('h3');
      title.textContent = picture.label || 'Untitled picture';

      const meta = document.createElement('p');
      meta.className = 'picture-meta';
      meta.textContent = formatFileSize(picture.sizeBytes);

      const button = document.createElement('button');
      button.className = 'delete-picture';
      button.type = 'button';
      button.dataset.action = 'delete-picture';
      button.textContent = 'Delete';

      card.append(image, title, meta, button);
      els.pictureGrid.append(card);
    });
  }

  async function handlePictureSelection() {
    resetCrop();

    const file = els.pictureFile.files[0];
    if (!file) return;

    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
      setUploadStatus('Choose a JPEG, PNG, or WebP image.', true);
      els.pictureFile.value = '';
      return;
    }

    setUploadStatus('Preparing crop…');

    try {
      const image = await loadImage(file);
      const baseScale = Math.max(CROP_SIZE / image.naturalWidth, CROP_SIZE / image.naturalHeight);

      cropState = {
        image,
        baseScale,
        zoom: 1,
        x: (CROP_SIZE - image.naturalWidth * baseScale) / 2,
        y: (CROP_SIZE - image.naturalHeight * baseScale) / 2,
        dragging: false,
        pointerId: null,
        lastClientX: 0,
        lastClientY: 0,
      };

      els.cropZoom.value = '1';
      els.cropEditor.hidden = false;
      clampCropPosition();
      renderCropPreview();
      setUploadStatus('');
    } catch (error) {
      resetCrop();
      setUploadStatus(error.message, true);
    }
  }

  function handleCropZoom() {
    if (!cropState) return;

    const oldScale = cropState.baseScale * cropState.zoom;
    const focusImageX = (CROP_SIZE / 2 - cropState.x) / oldScale;
    const focusImageY = (CROP_SIZE / 2 - cropState.y) / oldScale;

    cropState.zoom = Number(els.cropZoom.value);
    const newScale = cropState.baseScale * cropState.zoom;

    cropState.x = CROP_SIZE / 2 - focusImageX * newScale;
    cropState.y = CROP_SIZE / 2 - focusImageY * newScale;

    clampCropPosition();
    renderCropPreview();
  }

  function beginCropDrag(event) {
    if (!cropState) return;
    cropState.dragging = true;
    cropState.pointerId = event.pointerId;
    cropState.lastClientX = event.clientX;
    cropState.lastClientY = event.clientY;
    els.cropCanvas.classList.add('is-dragging');
    els.cropCanvas.setPointerCapture(event.pointerId);
  }

  function moveCropDrag(event) {
    if (!cropState || !cropState.dragging || event.pointerId !== cropState.pointerId) return;

    const rect = els.cropCanvas.getBoundingClientRect();
    const unitsPerCssPixel = CROP_SIZE / rect.width;
    const dx = (event.clientX - cropState.lastClientX) * unitsPerCssPixel;
    const dy = (event.clientY - cropState.lastClientY) * unitsPerCssPixel;

    cropState.lastClientX = event.clientX;
    cropState.lastClientY = event.clientY;
    cropState.x += dx;
    cropState.y += dy;

    clampCropPosition();
    renderCropPreview();
  }

  function endCropDrag(event) {
    if (!cropState || event.pointerId !== cropState.pointerId) return;
    cropState.dragging = false;
    cropState.pointerId = null;
    els.cropCanvas.classList.remove('is-dragging');

    if (els.cropCanvas.hasPointerCapture(event.pointerId)) {
      els.cropCanvas.releasePointerCapture(event.pointerId);
    }
  }

  function clampCropPosition() {
    if (!cropState) return;

    const scale = cropState.baseScale * cropState.zoom;
    const width = cropState.image.naturalWidth * scale;
    const height = cropState.image.naturalHeight * scale;

    cropState.x = Math.min(0, Math.max(CROP_SIZE - width, cropState.x));
    cropState.y = Math.min(0, Math.max(CROP_SIZE - height, cropState.y));
  }

  function renderCropPreview() {
    if (!cropState) return;

    const context = els.cropCanvas.getContext('2d', { alpha: false });
    const scale = cropState.baseScale * cropState.zoom;
    const width = cropState.image.naturalWidth * scale;
    const height = cropState.image.naturalHeight * scale;

    context.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, CROP_SIZE, CROP_SIZE);
    context.drawImage(cropState.image, cropState.x, cropState.y, width, height);
  }

  async function uploadPicture(event) {
    event.preventDefault();
    const file = els.pictureFile.files[0];
    const label = els.pictureLabel.value.trim();

    if (!file || !label) {
      setUploadStatus('Choose a picture and enter its spoken label.', true);
      return;
    }

    if (!cropState) {
      setUploadStatus('Wait for the picture crop to finish loading.', true);
      return;
    }

    setUploadBusy(true);
    setUploadStatus('Preparing cropped picture…');

    try {
      const prepared = prepareCroppedImage();
      setUploadStatus('Uploading picture…');

      await sendCommand('uploadPicture', {
        label,
        fileName: replaceFileExtension(file.name, '.jpg'),
        imageBase64: prepared.imageBase64,
        thumbnailDataUrl: prepared.thumbnailDataUrl,
      });

      els.pictureUploadForm.reset();
      resetCrop();
      setUploadStatus('Picture added.');
      await refreshPictureLibrary();
    } catch (error) {
      setUploadStatus(error.message, true);
    } finally {
      setUploadBusy(false);
    }
  }

  function prepareCroppedImage() {
    const imageDataUrl = renderCropToJpeg(UPLOAD_SIZE, .84);
    const thumbnailDataUrl = renderCropToJpeg(THUMBNAIL_SIZE, .72);
    const imageBase64 = imageDataUrl.split(',')[1];

    if (base64ByteLength(imageBase64) > 2 * 1024 * 1024) {
      throw new Error('This image could not be reduced enough for upload.');
    }
    if (thumbnailDataUrl.length > 50000) {
      throw new Error('This image produced an unusually large thumbnail.');
    }

    return { imageBase64, thumbnailDataUrl };
  }

  function renderCropToJpeg(outputSize, quality) {
    if (!cropState) throw new Error('No picture is ready to crop.');

    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;

    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, outputSize, outputSize);

    const outputScale = outputSize / CROP_SIZE;
    const scale = cropState.baseScale * cropState.zoom * outputScale;
    const x = cropState.x * outputScale;
    const y = cropState.y * outputScale;

    context.drawImage(
      cropState.image,
      x,
      y,
      cropState.image.naturalWidth * scale,
      cropState.image.naturalHeight * scale
    );

    return canvas.toDataURL('image/jpeg', quality);
  }

  function resetCrop() {
    cropState = null;

    if (els.cropEditor) els.cropEditor.hidden = true;

    if (els.cropCanvas) {
      const context = els.cropCanvas.getContext('2d');
      context.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
      els.cropCanvas.classList.remove('is-dragging');
    }

    if (els.cropZoom) els.cropZoom.value = '1';
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };

      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('The selected image could not be read.'));
      };

      image.src = url;
    });
  }

  async function handlePictureGridClick(event) {
    const button = event.target.closest('[data-action="delete-picture"]');
    if (!button) return;

    const card = button.closest('.picture-card');
    const label = card.querySelector('h3').textContent;
    if (!window.confirm(`Delete “${label}” from the Picture Library?`)) return;

    button.disabled = true;
    button.textContent = 'Deleting…';

    try {
      await sendCommand('deletePicture', { pictureId: card.dataset.pictureId });
      await refreshPictureLibrary();
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Delete';
      window.alert(error.message);
    }
  }

  function setUploadBusy(busy) {
    els.pictureFile.disabled = busy;
    els.pictureLabel.disabled = busy;
    els.cropZoom.disabled = busy;
    els.uploadPictureButton.disabled = busy;
    els.uploadPictureButton.textContent = busy ? 'Adding…' : 'Add picture';
  }

  function setUploadStatus(message, isError = false) {
    els.uploadStatus.textContent = message;
    els.uploadStatus.style.color = isError ? '#8b0000' : '';
  }

  function getSessionToken() {
    return localStorage.getItem(storageKey) || '';
  }

  function createRequestId() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function base64ByteLength(base64) {
    return Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  }

  function replaceFileExtension(fileName, extension) {
    const base = String(fileName || 'picture').replace(/\.[^.]+$/, '');
    return `${base || 'picture'}${extension}`;
  }

  function formatFileSize(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} bytes`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function signOut() {
    localStorage.removeItem(storageKey);
    currentUser = null;
    resetCrop();
    els.pictureGrid.replaceChildren();

    if (window.google && google.accounts && google.accounts.id) {
      google.accounts.id.disableAutoSelect();
    }

    showSignIn().catch((error) => showError(error.message));
  }

  function showError(message) {
    els.status.textContent = 'Could not continue.';
    els.errorView.textContent = message;
    els.errorView.hidden = false;
    els.signinView.hidden = true;
    els.dashboardView.hidden = true;
  }
})();
