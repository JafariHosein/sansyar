/**
 * Telegram Mini App development mock.
 *
 * Drop this script BEFORE the Telegram SDK in <head>. When the page is NOT
 * running inside Telegram (i.e. tgWebAppData is absent from the URL), it
 * installs a window.Telegram.WebApp polyfill that mirrors the real API closely
 * enough for development in a plain browser.
 *
 * When running inside Telegram this script does nothing — the real SDK takes
 * over naturally because the tgWebAppData query param is present.
 *
 * Sets window.isTelegramMockActive = true so app code can detect the mock.
 *
 * Usage (add to HTML before telegram-web-app.js):
 *   <script src="miniapp-mock.js"></script>
 *   <script src="https://telegram.org/js/telegram-web-app.js"></script>
 */

(function () {
  'use strict';

  // Only activate when NOT inside Telegram.
  // Telegram appends tgWebAppData to either the query string or the hash fragment.
  const params = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (params.has('tgWebAppData') || hashParams.has('tgWebAppData')) return;

  console.warn(
    '%c⚠️ Telegram WebApp mock active — not running inside Telegram',
    'background:#ff9800;color:#000;padding:2px 6px;border-radius:3px;font-weight:bold'
  );

  window.isTelegramMockActive = true;

  // ─── Theme ──────────────────────────────────────────────────────────────────

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  const LIGHT_THEME = {
    bg_color:               '#ffffff',
    secondary_bg_color:     '#f1f1f1',
    text_color:             '#222222',
    hint_color:             '#999999',
    link_color:             '#2481cc',
    button_color:           '#2481cc',
    button_text_color:      '#ffffff',
    header_bg_color:        '#ffffff',
    accent_text_color:      '#2481cc',
    section_bg_color:       '#ffffff',
    section_header_text_color: '#6d6d71',
    subtitle_text_color:    '#999999',
    destructive_text_color: '#ff3b30',
    bottom_bar_bg_color:    '#ffffff',
  };

  const DARK_THEME = {
    bg_color:               '#212121',
    secondary_bg_color:     '#0f0f0f',
    text_color:             '#ffffff',
    hint_color:             '#708499',
    link_color:             '#5aa3d7',
    button_color:           '#5aa3d7',
    button_text_color:      '#ffffff',
    header_bg_color:        '#212121',
    accent_text_color:      '#5aa3d7',
    section_bg_color:       '#212121',
    section_header_text_color: '#708499',
    subtitle_text_color:    '#708499',
    destructive_text_color: '#ff453a',
    bottom_bar_bg_color:    '#1c1c1e',
  };

  let themeParams = prefersDark ? DARK_THEME : LIGHT_THEME;

  function applyCssVars(p) {
    const root = document.documentElement.style;
    for (const [key, val] of Object.entries(p)) {
      root.setProperty('--tg-theme-' + key.replace(/_/g, '-'), val);
    }
  }

  applyCssVars(themeParams);
  document.addEventListener('DOMContentLoaded', () => applyCssVars(themeParams));

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    themeParams = e.matches ? DARK_THEME : LIGHT_THEME;
    applyCssVars(themeParams);
    emit('themeChanged');
  });

  // ─── Event emitter ──────────────────────────────────────────────────────────

  const listeners = {};

  function on(event, cb) {
    (listeners[event] = listeners[event] || []).push(cb);
  }

  function off(event, cb) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter((fn) => fn !== cb);
  }

  function emit(event, data) {
    (listeners[event] || []).forEach((fn) => {
      try { fn(data); } catch (e) { console.error('WebApp mock event error', e); }
    });
  }

  // ─── Viewport ───────────────────────────────────────────────────────────────

  function getViewportHeight() { return window.innerHeight; }

  window.addEventListener('resize', () => {
    emit('viewportChanged', { isStateStable: true });
  });

  // ─── Fake initData ───────────────────────────────────────────────────────────

  const MOCK_USER = {
    id: 123456789,
    first_name: 'Dev',
    last_name: 'User',
    username: 'devuser',
    language_code: 'en',
    is_premium: false,
  };

  // Use ?mock=empty to test the empty-initData browser-detection path
  // (see references/security.md for the empty-initData guard pattern)
  const FORCE_EMPTY_INIT_DATA = params.get('mock') === 'empty';

  // Use ?mock=inline to simulate inline-mode launch (adds query_id to initData)
  const MOCK_INLINE = params.get('mock') === 'inline';
  const _startParam = params.get('tgWebAppStartParam') || '';

  const MOCK_INIT_DATA_UNSAFE = FORCE_EMPTY_INIT_DATA ? {} : {
    ...(MOCK_INLINE ? { query_id: 'mock_query_id' } : {}),
    user: MOCK_USER,
    auth_date: Math.floor(Date.now() / 1000),
    hash: 'mock_hash_not_valid_for_backend',
    start_param: _startParam || undefined,
  };

  const MOCK_INIT_DATA = FORCE_EMPTY_INIT_DATA ? '' :
    (MOCK_INLINE ? 'query_id=mock_query_id&' : '') +
    'user=' + encodeURIComponent(JSON.stringify(MOCK_USER)) +
    '&auth_date=' + MOCK_INIT_DATA_UNSAFE.auth_date +
    (_startParam ? '&start_param=' + encodeURIComponent(_startParam) : '') +
    '&hash=mock_hash_not_valid_for_backend';

  // ─── Shared styles injection ─────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('tg-mock-styles')) return;
    const style = document.createElement('style');
    style.id = 'tg-mock-styles';
    style.textContent = `
      #tg-mock-main-btn, #tg-mock-secondary-btn {
        position: fixed;
        left: 0;
        right: 0;
        border: none;
        height: 52px;
        cursor: pointer;
        font-size: 16px;
        font-weight: 600;
        z-index: 9999;
        display: none;
        transition: opacity 0.15s;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      #tg-mock-main-btn      { bottom: 0; }
      #tg-mock-secondary-btn { bottom: 52px; }
      #tg-mock-back-btn {
        position: fixed;
        top: 8px;
        left: 12px;
        z-index: 9999;
        background: rgba(0,0,0,0.12);
        border: none;
        border-radius: 20px;
        padding: 6px 14px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        display: none;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
    `;
    document.head.appendChild(style);
  }

  // ─── UI Buttons (real DOM elements) ─────────────────────────────────────────

  function makeButton(id, defaultBg, defaultText) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.style.background = defaultBg;
    btn.style.color = defaultText;

    function appendWhenReady() {
      if (document.body) {
        injectStyles();
        document.body.appendChild(btn);
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          injectStyles();
          document.body.appendChild(btn);
        });
      }
    }
    appendWhenReady();

    let _text = '';
    let _isVisible = false;
    let _isActive = true;
    let _showProgress = false;
    const _clickHandlers = [];

    function _render() {
      btn.style.display = _isVisible ? 'block' : 'none';
      btn.disabled = !_isActive || _showProgress;
      btn.style.opacity = btn.disabled ? '0.6' : '1';
      btn.textContent = _showProgress ? '...' : _text;
    }

    btn.addEventListener('click', () => {
      if (_isActive && !_showProgress) {
        _clickHandlers.forEach((fn) => { try { fn(); } catch(e) {} });
      }
    });

    return {
      get text()            { return _text; },
      get isVisible()       { return _isVisible; },
      get isActive()        { return _isActive; },
      get isProgressVisible(){ return _showProgress; },
      get color()           { return btn.style.background; },
      get textColor()       { return btn.style.color; },

      setText(t)            { _text = t; _render(); return this; },
      show()                { _isVisible = true; _render(); return this; },
      hide()                { _isVisible = false; _render(); return this; },
      enable()              { _isActive = true; _render(); return this; },
      disable()             { _isActive = false; _render(); return this; },
      showProgress(leaveActive) {
        _showProgress = true;
        if (!leaveActive) _isActive = false;
        _render(); return this;
      },
      hideProgress() { _showProgress = false; _isActive = true; _render(); return this; },
      onClick(cb)    { _clickHandlers.push(cb); return this; },
      offClick(cb)   {
        const i = _clickHandlers.indexOf(cb);
        if (i !== -1) _clickHandlers.splice(i, 1);
        return this;
      },
      setParams(p) {
        if (p.color)       btn.style.background = p.color;
        if (p.text_color)  btn.style.color = p.text_color;
        if (p.text)        { _text = p.text; }
        if (p.is_active   !== undefined) { _isActive  = p.is_active; }
        if (p.is_visible  !== undefined) { _isVisible = p.is_visible; }
        // has_shine_effect and position are accepted but not visually rendered in the mock
        if (p.has_shine_effect !== undefined || p.position !== undefined) {
          console.info('[TG Mock] setParams: has_shine_effect/position are not visually simulated in the mock');
        }
        _render();
        return this;
      },
    };
  }

  const MainButton = makeButton(
    'tg-mock-main-btn',
    themeParams.button_color,
    themeParams.button_text_color
  );

  const SecondaryButton = makeButton(
    'tg-mock-secondary-btn',
    themeParams.secondary_bg_color,
    themeParams.text_color
  );

  // ─── BackButton (visible pill in top-left corner, Escape key shortcut) ──────

  const BackButton = (() => {
    const btn = document.createElement('button');
    btn.id = 'tg-mock-back-btn';
    btn.textContent = '← Back';

    function appendWhenReady() {
      if (document.body) {
        injectStyles();
        document.body.appendChild(btn);
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          injectStyles();
          document.body.appendChild(btn);
        });
      }
    }
    appendWhenReady();

    let _visible = false;

    // Route all triggers through the event bus so onClick and onEvent('backButtonClicked')
    // behave identically and each registered handler fires exactly once per event.
    btn.addEventListener('click', () => {
      if (_visible) emit('backButtonClicked');
    });

    // Escape key fires BackButton (mirrors the Android physical back button)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _visible) emit('backButtonClicked');
    });

    function _render() {
      btn.style.display = _visible ? 'block' : 'none';
    }

    return {
      get isVisible() { return _visible; },
      show() { _visible = true; _render(); return this; },
      hide() { _visible = false; _render(); return this; },
      onClick(cb)  { on('backButtonClicked', cb);  return this; },
      offClick(cb) { off('backButtonClicked', cb); return this; },
    };
  })();

  // ─── SettingsButton ──────────────────────────────────────────────────────────

  const SettingsButton = (() => {
    let _visible = false;
    return {
      get isVisible() { return _visible; },
      show()   { _visible = true;  console.log('[TG Mock] SettingsButton visible (press S to trigger)'); return this; },
      hide()   { _visible = false; return this; },
      onClick(cb)  { on('settingsButtonClicked', cb); return this; },
      offClick(cb) { off('settingsButtonClicked', cb); return this; },
    };
  })();

  // Dev shortcut: press S to fire settingsButtonClicked
  document.addEventListener('keydown', (e) => {
    if (e.key === 's' && !e.ctrlKey && !e.metaKey && !e.altKey &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA') {
      emit('settingsButtonClicked');
    }
  });

  // ─── HapticFeedback ──────────────────────────────────────────────────────────

  const HapticFeedback = {
    impactOccurred(style) {
      console.log('[TG Mock] HapticFeedback.impactOccurred:', style);
      if (navigator.vibrate) navigator.vibrate(style === 'heavy' ? 40 : 15);
    },
    notificationOccurred(type) {
      console.log('[TG Mock] HapticFeedback.notificationOccurred:', type);
      if (navigator.vibrate) navigator.vibrate(type === 'error' ? [30, 20, 30] : 20);
    },
    selectionChanged() {
      console.log('[TG Mock] HapticFeedback.selectionChanged');
      if (navigator.vibrate) navigator.vibrate(10);
    },
  };

  // ─── CloudStorage (localStorage-backed) ─────────────────────────────────────

  const CLOUD_PREFIX = '__tg_cloud__';

  const CloudStorage = {
    setItem(key, value, cb) {
      try { localStorage.setItem(CLOUD_PREFIX + key, value); cb && cb(null, true); }
      catch(e) { cb && cb(e, false); }
    },
    getItem(key, cb) {
      const val = localStorage.getItem(CLOUD_PREFIX + key);
      cb && cb(null, val === null ? undefined : val);
    },
    getItems(keys, cb) {
      const result = {};
      keys.forEach((k) => {
        const v = localStorage.getItem(CLOUD_PREFIX + k);
        result[k] = v === null ? undefined : v;
      });
      cb && cb(null, result);
    },
    removeItem(key, cb)  { localStorage.removeItem(CLOUD_PREFIX + key); cb && cb(null, true); },
    removeItems(keys, cb){ keys.forEach((k) => localStorage.removeItem(CLOUD_PREFIX + k)); cb && cb(null, true); },
    getKeys(cb) {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CLOUD_PREFIX)) keys.push(k.slice(CLOUD_PREFIX.length));
      }
      cb && cb(null, keys);
    },
  };

  // ─── DeviceStorage (localStorage-backed, different namespace) ───────────────

  const DEVICE_PREFIX = '__tg_device__';

  const DeviceStorage = {
    setItem(key, value, cb) {
      try { localStorage.setItem(DEVICE_PREFIX + key, value); cb && cb(null, true); }
      catch(e) { cb && cb(e, false); }
    },
    getItem(key, cb) {
      const val = localStorage.getItem(DEVICE_PREFIX + key);
      cb && cb(null, val === null ? undefined : val);
    },
    getItems(keys, cb) {
      const result = {};
      keys.forEach((k) => {
        const v = localStorage.getItem(DEVICE_PREFIX + k);
        result[k] = v === null ? undefined : v;
      });
      cb && cb(null, result);
    },
    removeItem(key, cb)  { localStorage.removeItem(DEVICE_PREFIX + key); cb && cb(null, true); },
    removeItems(keys, cb){ keys.forEach((k) => localStorage.removeItem(DEVICE_PREFIX + k)); cb && cb(null, true); },
    clear(cb) {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(DEVICE_PREFIX)) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
      cb && cb(null, true);
    },
  };

  // ─── SecureStorage (sessionStorage-backed) ───────────────────────────────────

  const SECURE_PREFIX = '__tg_secure__';

  const SecureStorage = {
    setItem(key, value, cb) {
      try { sessionStorage.setItem(SECURE_PREFIX + key, value); cb && cb(null, true); }
      catch(e) { cb && cb(e, false); }
    },
    getItem(key, cb) {
      const val = sessionStorage.getItem(SECURE_PREFIX + key);
      cb && cb(null, val === null ? undefined : val);
    },
    removeItem(key, cb) { sessionStorage.removeItem(SECURE_PREFIX + key); cb && cb(null, true); },
    restoreItem(key, cb) {
      // In dev, "restore from cloud" just re-reads sessionStorage
      const val = sessionStorage.getItem(SECURE_PREFIX + key);
      cb && cb(null, val === null ? undefined : val);
    },
    getKeys(cb) {
      const keys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(SECURE_PREFIX)) keys.push(k.slice(SECURE_PREFIX.length));
      }
      cb && cb(null, keys);
    },
    clear(cb) {
      const toRemove = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(SECURE_PREFIX)) toRemove.push(k);
      }
      toRemove.forEach(k => sessionStorage.removeItem(k));
      cb && cb(null, true);
    },
  };

  // ─── Stub objects for Bot API 8.0 gated features ────────────────────────────
  // These return safe no-op defaults so version gates resolve without throwing.

  const LocationManager = {
    isInited: false,
    isLocationAvailable: false,
    isAccessRequested: false,
    isAccessGranted: false,
    init(cb) { console.log('[TG Mock] LocationManager.init — not available in browser'); cb && cb(); },
    getLocation(cb) { cb && cb(null); },
    openSettings() {},
  };

  const Accelerometer = {
    isStarted: false,
    x: 0, y: 0, z: 0,
    start(params, cb) {
      console.warn('[TG Mock] Accelerometer.start — stub only. No accelerometerChanged events will fire in browser dev mode. Test on a real device.');
      this.isStarted = true;
      cb && cb();
    },
    stop(cb) { this.isStarted = false; cb && cb(); },
  };

  const Gyroscope = {
    isStarted: false,
    x: 0, y: 0, z: 0,
    start(params, cb) {
      console.warn('[TG Mock] Gyroscope.start — stub only. No gyroscopeChanged events will fire in browser dev mode. Test on a real device.');
      this.isStarted = true;
      cb && cb();
    },
    stop(cb) { this.isStarted = false; cb && cb(); },
  };

  const DeviceOrientation = {
    isStarted: false,
    absolute: false,
    alpha: 0, beta: 0, gamma: 0,
    start(params, cb) {
      console.warn('[TG Mock] DeviceOrientation.start — stub only. No deviceOrientationChanged events will fire in browser dev mode. Test on a real device.');
      this.isStarted = true;
      cb && cb();
    },
    stop(cb) { this.isStarted = false; cb && cb(); },
  };

  const BiometricManager = {
    isInited: false,
    isBiometricAvailable: false,
    biometricType: 'unknown',
    isAccessRequested: false,
    isAccessGranted: false,
    isBiometricTokenSaved: false,
    deviceId: 'mock-device',
    init(cb) { cb && cb(); },
    requestAccess(params, cb) { cb && cb(false); },
    authenticate(params, cb) { cb && cb(false, ''); },
    updateBiometricToken(token, cb) { cb && cb(false); },
    openSettings() {},
  };

  // ─── Popup helpers ───────────────────────────────────────────────────────────

  function showPopup(popupParams, cb) {
    const msg = (popupParams.title ? popupParams.title + '\n\n' : '') + (popupParams.message || '');
    const buttons = popupParams.buttons || [{ id: 'ok', type: 'ok' }];
    const okBtn     = buttons.find((b) => b.type === 'ok' || b.type === 'default');
    const cancelBtn = buttons.find((b) => b.type === 'cancel' || b.type === 'destructive');

    if (okBtn && cancelBtn) {
      const result = window.confirm(msg);
      cb && cb(result ? okBtn.id : cancelBtn.id);
    } else {
      window.alert(msg);
      cb && cb(okBtn ? okBtn.id : '');
    }
  }

  // ─── Version gate ────────────────────────────────────────────────────────────
  // Matches the highest stable Bot API version; update as Telegram releases new versions.
  const MOCK_VERSION = '9.0';

  function isVersionAtLeast(version) {
    const toNum = (v) => v.split('.').map((n) => parseInt(n, 10) || 0);
    const [maMaj, maMin = 0] = toNum(MOCK_VERSION);
    const [maj,   min   = 0] = toNum(version);
    return maMaj > maj || (maMaj === maj && maMin >= min);
  }

  // ─── Assemble window.Telegram.WebApp ─────────────────────────────────────────

  const WebApp = {
    // Data
    initData:       MOCK_INIT_DATA,
    initDataUnsafe: MOCK_INIT_DATA_UNSAFE,
    version:        MOCK_VERSION,
    platform:       'mock',

    // Theme
    get colorScheme()  { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; },
    get themeParams()  { return Object.assign({}, themeParams); },

    // Viewport
    get viewportHeight()       { return getViewportHeight(); },
    get viewportStableHeight() { return getViewportHeight(); },
    isExpanded:    true,
    isFullscreen:  false,

    // Controls
    MainButton,
    SecondaryButton,
    BackButton,
    SettingsButton,
    HapticFeedback,

    // Storage
    CloudStorage,
    DeviceStorage,
    SecureStorage,

    // Advanced APIs (Bot API 8.0 — stubs, not available in browser)
    LocationManager,
    Accelerometer,
    Gyroscope,
    DeviceOrientation,
    BiometricManager,

    // Lifecycle
    ready()  { console.log('[TG Mock] ready()'); },
    expand() { console.log('[TG Mock] expand()'); },
    close()  { console.log('[TG Mock] close() — would close the Mini App'); },
    sendData(data) { console.log('[TG Mock] sendData():', data); },

    // Popups
    showPopup,
    showAlert(msg, cb)    { window.alert(msg); cb && cb(); },
    showConfirm(msg, cb)  { cb && cb(window.confirm(msg)); },
    showScanQrPopup(scanParams, cb) {
      console.log('[TG Mock] showScanQrPopup — not available in browser');
      cb && cb('');
    },
    closeScanQrPopup() {},

    // Contact / write access
    requestContact(cb) {
      // Real callback: (shared: boolean) only — phone goes to bot webhook, not Mini App
      console.log('[TG Mock] requestContact — simulating user accepted (shared=true)');
      console.log('[TG Mock] In production the phone number is delivered to your bot webhook, not this callback.');
      cb && cb(true);
    },
    requestWriteAccess(cb) {
      console.log('[TG Mock] requestWriteAccess — granted');
      cb && cb(true);
    },

    // Links
    openLink(url, options) {
      console.log('[TG Mock] openLink:', url, options);
      window.open(url, '_blank', 'noopener');
    },
    openTelegramLink(url) { window.open(url, '_blank', 'noopener'); },
    openInvoice(url, cb) {
      // Simulate different outcomes via ?mock_invoice=paid|failed|pending (default: cancelled)
      const status = new URLSearchParams(location.search).get('mock_invoice') || 'cancelled';
      console.log(`[TG Mock] openInvoice — simulating status="${status}". Use ?mock_invoice=paid to test success path. URL:`, url);
      setTimeout(() => cb && cb(status), 500);
    },

    // Colors
    setHeaderColor(color)    { console.log('[TG Mock] setHeaderColor:', color); },
    setBackgroundColor(color){ console.log('[TG Mock] setBackgroundColor:', color); },
    setBottomBarColor(color) { console.log('[TG Mock] setBottomBarColor:', color); },

    // File download
    downloadFile(dlParams, cb) {
      console.log('[TG Mock] downloadFile:', dlParams.url);
      const a = document.createElement('a');
      a.href = dlParams.url;
      a.download = dlParams.file_name || 'download';
      a.click();
      cb && cb(true);
    },

    // Closing confirmation
    enableClosingConfirmation()  { console.log('[TG Mock] enableClosingConfirmation'); },
    disableClosingConfirmation() { console.log('[TG Mock] disableClosingConfirmation'); },

    // Fullscreen (Bot API 8.0)
    requestFullscreen() { console.log('[TG Mock] requestFullscreen'); },
    exitFullscreen()    { console.log('[TG Mock] exitFullscreen'); },

    // Home screen
    addToHomeScreen()            { console.log('[TG Mock] addToHomeScreen'); },
    checkHomeScreenStatus(cb)    { cb && cb('unknown'); },

    // Version gating
    isVersionAtLeast,

    // Events
    onEvent:  on,
    offEvent: off,
  };

  // Expose under window.Telegram.WebApp (same path as the real SDK)
  window.Telegram = window.Telegram || {};
  window.Telegram.WebApp = WebApp;
})();
