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
  let pictureLibraryCount = 0;
  let pictureLibraryLimit = 8;
  let uploadBusy = false;

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
      pictureCount: document.getElementById('pictureCount'),
      pictureLimitMessage: document.getElementById('pictureLimitMessage'),
      cropEditor: document.getElementById('cropEditor'),
      cropCanvas: document.getElementById('cropCanvas'),
      cropZoom: document.getElementById('cropZoom'),
      uploadPictureButton: document.getElementById('uploadPictureButton'),
      uploadStatus: document.getElementById('uploadStatus'),
      pictureGrid: document.getElementById('pictureGrid'),
      pictureEmpty: document.getElementById('pictureEmpty'),
      picturesPanel: document.getElementById('picturesPanel'),
      drawingsPanel: document.getElementById('drawingsPanel'),
      drawingGrid: document.getElementById('drawingGrid'),
      drawingEmpty: document.getElementById('drawingEmpty'),
      drawingCount: document.getElementById('drawingCount'),
      refreshDrawings: document.getElementById('refreshDrawings'),
      pairingPanel: document.getElementById('pairingPanel'),
      generatePairingCode: document.getElementById('generatePairingCode'),
      pairingCodeView: document.getElementById('pairingCodeView'),
      pairingCode: document.getElementById('pairingCode'),
      pairingExpiry: document.getElementById('pairingExpiry'),
      pairingStatus: document.getElementById('pairingStatus'),
      refreshDevices: document.getElementById('refreshDevices'),
      pairedDevices: document.getElementById('pairedDevices'),
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
    els.drawingGrid.addEventListener('click', handleDrawingGridClick);
    els.refreshDrawings.addEventListener('click', () => refreshDrawings().catch((error) => window.alert(error.message)));
    document.querySelectorAll('.tab[data-section]').forEach((tab) => tab.addEventListener('click', () => showSection(tab.dataset.section)));
    els.generatePairingCode.addEventListener('click', generatePairingCode);
    els.refreshDevices.addEventListener('click', refreshDevices);
    els.pairedDevices.addEventListener('click', handleDeviceClick);

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

    await Promise.all([refreshPictureLibrary(), refreshDrawings(), refreshDevices()]);
  }

  async function refreshPictureLibrary() {
    const token = getSessionToken();
    const result = await callBackend('listPictures', { sessionToken: token });
    const pictures = result.pictures || [];
    pictureLibraryCount = Number.isFinite(Number(result.count)) ? Number(result.count) : pictures.length;
    pictureLibraryLimit = Number.isFinite(Number(result.limit)) ? Number(result.limit) : 8;
    renderPictures(pictures);
    updatePictureLibraryAvailability();
  }

  function updatePictureLibraryAvailability() {
    const full = pictureLibraryCount >= pictureLibraryLimit;
    els.pictureCount.textContent = `${pictureLibraryCount} of ${pictureLibraryLimit} pictures`;
    els.pictureLimitMessage.hidden = !full;

    els.pictureFile.disabled = uploadBusy || full;
    els.pictureLabel.disabled = uploadBusy || full;
    els.cropZoom.disabled = uploadBusy || full || !cropState;
    els.uploadPictureButton.disabled = uploadBusy || full;
    els.uploadPictureButton.textContent = full
      ? 'Library full'
      : uploadBusy
        ? 'Adding…'
        : 'Add picture';

    if (full) {
      resetCrop();
      els.pictureFile.value = '';
    }
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

  async function refreshDrawings() {
    const token = getSessionToken();
    const result = await callBackend('listDrawings', { sessionToken: token });
    const drawings = result.drawings || [];
    els.drawingCount.textContent = `${drawings.length} saved`;
    renderDrawings(drawings);
  }

  function renderDrawings(drawings) {
    els.drawingGrid.replaceChildren();
    els.drawingEmpty.hidden = drawings.length !== 0;
    drawings.forEach((drawing) => {
      const card = document.createElement('article');
      card.className = 'drawing-card';
      card.dataset.drawingId = drawing.drawingId;

      const image = document.createElement('img');
      image.alt = `Art Lab drawing saved ${formatDateTime(drawing.createdAt)}`;
      image.loading = 'lazy';
      image.src = drawing.thumbnailDataUrl;

      const meta = document.createElement('div');
      meta.className = 'drawing-meta';
      const date = document.createElement('strong');
      date.textContent = formatDateTime(drawing.createdAt);
      const details = document.createElement('span');
      details.textContent = `${drawing.deviceName || 'Wonder Lab tablet'} · ${formatFileSize(drawing.sizeBytes)}`;
      meta.append(date, details);

      const actions = document.createElement('div');
      actions.className = 'drawing-actions';
      const download = document.createElement('button');
      download.type = 'button'; download.dataset.action = 'download-drawing'; download.textContent = 'Download';
      const remove = document.createElement('button');
      remove.type = 'button'; remove.dataset.action = 'delete-drawing'; remove.className = 'delete-drawing'; remove.textContent = 'Delete';
      actions.append(download, remove);
      card.append(image, meta, actions);
      els.drawingGrid.append(card);
    });
  }

  async function handleDrawingGridClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const card = button.closest('.drawing-card');
    const drawingId = card?.dataset.drawingId;
    if (!drawingId) return;

    if (button.dataset.action === 'delete-drawing') {
      if (!window.confirm('Delete this saved drawing?')) return;
      button.disabled = true; button.textContent = 'Deleting…';
      try { await sendCommand('deleteDrawing', { drawingId }); await refreshDrawings(); }
      catch (error) { button.disabled = false; button.textContent = 'Delete'; window.alert(error.message); }
      return;
    }

    if (button.dataset.action === 'download-drawing') {
      button.disabled = true; button.textContent = 'Preparing…';
      try {
        const result = await callBackend('getDrawingContent', { sessionToken: getSessionToken(), drawingId });
        const bytes = Uint8Array.from(atob(result.imageBase64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: result.mimeType || 'image/png' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = result.fileName || `wonder-lab-drawing-${drawingId}.png`;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) { window.alert(error.message); }
      finally { button.disabled = false; button.textContent = 'Download'; }
    }
  }

  async function handlePictureSelection() {
    if (pictureLibraryCount >= pictureLibraryLimit) {
      updatePictureLibraryAvailability();
      return;
    }

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

    if (pictureLibraryCount >= pictureLibraryLimit) {
      setUploadStatus('Picture Library is full. Remove a picture before adding another.', true);
      updatePictureLibraryAvailability();
      return;
    }
    const file = els.pictureFile.files[0];
    const label = els.pictureLabel.value.trim().toLocaleUpperCase();

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
    uploadBusy = busy;
    updatePictureLibraryAvailability();
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



  function showSection(section) {
    const pairing = section === 'pairing';
    const drawings = section === 'drawings';
    els.picturesPanel.hidden = section !== 'pictures';
    els.drawingsPanel.hidden = !drawings;
    els.pairingPanel.hidden = !pairing;
    document.querySelectorAll('.tab[data-section]').forEach((tab) => {
      const active = tab.dataset.section === section;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (pairing) refreshDevices().catch((error) => setPairingStatus(error.message, true));
    if (drawings) refreshDrawings().catch((error) => window.alert(error.message));
  }

  async function generatePairingCode() {
    els.generatePairingCode.disabled = true;
    setPairingStatus('Generating code…');
    try {
      const result = await callBackend('createPairingCode', { sessionToken: getSessionToken() });
      els.pairingCode.textContent = result.displayCode || result.code || '';
      els.pairingExpiry.textContent = `Valid for 10 minutes. Expires ${formatDateTime(result.expiresAt)}.`;
      els.pairingCodeView.hidden = false;
      setPairingStatus('Enter this code on the tablet in Parental Controls → Device pairing.');
    } catch (error) {
      setPairingStatus(error.message, true);
    } finally {
      els.generatePairingCode.disabled = false;
    }
  }

  async function refreshDevices() {
    const token = getSessionToken();
    if (!token || !els.pairedDevices) return;
    const result = await callBackend('listDevices', { sessionToken: token });
    renderDevices(result.devices || []);
  }

  function renderDevices(devices) {
    els.pairedDevices.replaceChildren();
    if (!devices.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No tablets have been paired yet.';
      els.pairedDevices.appendChild(empty);
      return;
    }

    devices.forEach((device) => {
      const card = document.createElement('article');
      card.className = 'device-card';
      card.dataset.deviceId = device.deviceId;

      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = device.deviceName || 'Wonder Lab tablet';
      const status = document.createElement('span');
      status.className = `device-status ${device.status === 'revoked' ? 'revoked' : ''}`;
      status.textContent = device.status || 'active';
      const meta = document.createElement('p');
      const seen = device.lastSeenAt ? `Last seen ${formatDateTime(device.lastSeenAt)}` : 'Not seen yet';
      meta.textContent = `Paired ${formatDateTime(device.pairedAt)} · ${seen}`;
      info.append(title, status, meta);
      card.appendChild(info);

      if (device.status !== 'revoked') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'revoke-device';
        button.dataset.action = 'revoke-device';
        button.textContent = 'Revoke';
        card.appendChild(button);
      }
      els.pairedDevices.appendChild(card);
    });
  }

  async function handleDeviceClick(event) {
    const button = event.target.closest('[data-action="revoke-device"]');
    if (!button) return;
    const card = button.closest('.device-card');
    const name = card.querySelector('strong')?.textContent || 'this tablet';
    if (!window.confirm(`Revoke ${name}? It will stop syncing until it is paired again.`)) return;

    button.disabled = true;
    try {
      await sendCommand('revokeDevice', { deviceId: card.dataset.deviceId });
      await refreshDevices();
      setPairingStatus('Device revoked.');
    } catch (error) {
      button.disabled = false;
      setPairingStatus(error.message, true);
    }
  }

  function setPairingStatus(message, isError = false) {
    if (!els.pairingStatus) return;
    els.pairingStatus.textContent = message || '';
    els.pairingStatus.style.color = isError ? '#8b0000' : '';
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  function signOut() {
    localStorage.removeItem(storageKey);
    currentUser = null;
    pictureLibraryCount = 0;
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
