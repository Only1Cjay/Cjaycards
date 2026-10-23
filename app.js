/* ============================================================
   CjayCards — app.js
   ============================================================ */

(() => {
  'use strict';

  const LS = {
    family: 'cjaycards.family',
    mode: 'cjaycards.mode',
    installDismissed: 'cjaycards.installDismissed',
    recentDecks: 'cjaycards.recent_decks'
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    readOnly: false,
    demoMode: false,
    data: null,
    tab: 'decks',
    sortMode: 'due',
    currentDeckId: null,
    study: null,
    bulkMode: false,
    selectedCards: new Set()
  };

  const RATING_LABELS = ['Again', 'Hard', 'Good', 'Easy'];
  const RATING_CLASSES = ['again', 'hard', 'good', 'easy'];

  /* ---------------------------------------------------------- */
  /* CLOUDFLARE SYNC CONFIG                                      */
  /* ---------------------------------------------------------- */
  const WORKER_URL = 'https://cjay-cloud.monaplayzsbackup.workers.dev';
  const APP_ID = 'cjaycards';
  const DEFAULT_SYNC_TOKEN = 'cjc_p8x2m5n9q4w7r3t6y1u8v2b5c9d4f7e1';
  const SYNC_TOKEN_KEY = 'cjaycards_sync_token';
  const PUSH_FLAG_KEY = 'cjaycards_push_enabled';
  const SYNC_TIME_KEY = 'cjaycards_last_sync';

  let isSyncing = false;
  let syncTimeout = null;

  /* ---------------------------------------------------------- */
  /* URL flags                                                   */
  /* ---------------------------------------------------------- */
  function parseUrlFlags() {
    const params = new URLSearchParams(location.search);
    state.demoMode = params.get('view') === '1';
    state.readOnly = state.demoMode;
  }

  /* ---------------------------------------------------------- */
  /* Theme                                                       */
  /* ---------------------------------------------------------- */
  const THEME_FAMILIES = [
    { id: 'slate', name: 'Slate', c1: '#EFF3F7', c2: '#3D9BC9' },
    { id: 'ink', name: 'Ink', c1: '#FAFAF7', c2: '#8AAF1D' },
    { id: 'espresso', name: 'Espresso', c1: '#F5EFE4', c2: '#C99B62' }
  ];

  function getFamily() { return document.documentElement.getAttribute('data-family') || 'slate'; }
  function getMode() { return document.documentElement.getAttribute('data-mode') || 'light'; }

  function applyTheme(family, mode) {
    document.documentElement.setAttribute('data-family', family);
    document.documentElement.setAttribute('data-mode', mode);

    const icon = $('#themeIcon');
    if (icon) icon.className = mode === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      meta.setAttribute('content', bg || '#EFF3F7');
    }
  }

  function persistTheme(family, mode) {
    if (state.readOnly) return;
    localStorage.setItem(LS.family, family);
    localStorage.setItem(LS.mode, mode);
    Storage.updateSettings({ family, mode });
    state.data = Storage.getData();
  }

  /* ---------------------------------------------------------- */
  /* SYNC ENGINE                                                 */
  /* ---------------------------------------------------------- */
  function updateSyncIcon(status) {
    const icon = $('#syncIcon');
    if (!icon) return;
    icon.className = 'fa-solid sync-icon ' + status;
    if (status === 'synced') icon.className = 'fa-solid fa-cloud sync-icon synced';
    if (status === 'syncing') icon.className = 'fa-solid fa-arrows-rotate fa-spin sync-icon syncing';
    if (status === 'offline' || status === 'error') icon.className = 'fa-solid fa-cloud-slash sync-icon offline';
  }

  function scheduleSync() {
    if (isSyncing || state.readOnly) return;
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => { syncToWorker(); }, 2000);
  }

  async function syncToWorker() {
    if (isSyncing || state.readOnly) return;
    const token = localStorage.getItem(SYNC_TOKEN_KEY) || DEFAULT_SYNC_TOKEN;
    if (!token) return;

    if (!navigator.onLine) {
      updateSyncIcon('offline');
      return;
    }

    isSyncing = true;
    updateSyncIcon('syncing');
    
    const statusEl = document.getElementById('syncStatusBox');
    if (statusEl) { statusEl.textContent = 'Syncing...'; statusEl.style.color = 'var(--accent)'; }

    try {
      const data = Storage.getData();
      const payload = {
        collections: { decks: data.decks, cards: data.cards },
        deletedIds: { decks: data.deletedIds.decks, cards: data.deletedIds.cards },
        settings: { family: getFamily(), mode: getMode() }
      };

      const res = await fetch(`${WORKER_URL}/v1/sync/${APP_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Sync-Token': token },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('HTTP ' + res.status);
      const result = await res.json();
      if (!result.ok) throw new Error(result.error || 'Sync failed');

      const newData = Storage.getData();
      newData.decks = result.collections.decks;
      newData.cards = result.collections.cards;
      newData.deletedIds = result.deletedIds;
      
      Storage.setData(newData); 
      state.data = Storage.getData();
      
      if (result.settings) {
        applyTheme(result.settings.family || 'slate', result.settings.mode || 'light');
      }

      localStorage.setItem(SYNC_TIME_KEY, new Date().toISOString());
      
      if (statusEl) { statusEl.textContent = 'Synced · ' + newData.cards.length + ' cards'; statusEl.style.color = 'var(--easy)'; }
      updateSyncIcon('synced');
      
      refresh();
      if (!$('#viewRoot').hidden && state.currentDeckId) {
        const v = $('#viewRoot .view');
        if (v) renderDeckDetail(v, state.currentDeckId);
      }
    } catch (err) {
      console.error('[sync]', err);
      if (statusEl) { statusEl.textContent = 'Sync failed'; statusEl.style.color = 'var(--again)'; }
      updateSyncIcon('error');
    } finally {
      isSyncing = false;
    }
  }

  window.addEventListener('cjaycards-storage-changed', scheduleSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncToWorker();
  });
  window.addEventListener('online', () => updateSyncIcon('synced'));
  window.addEventListener('offline', () => updateSyncIcon('offline'));

  /* ---------------------------------------------------------- */
  /* PUSH NOTIFICATIONS                                          */
  /* ---------------------------------------------------------- */
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  function updatePushUI() {
    const enabled = localStorage.getItem(PUSH_FLAG_KEY) === '1';
    const btn = document.getElementById('enablePushBtn');
    if (btn) btn.textContent = enabled ? 'Disable Notifications' : 'Enable Notifications';
  }

  async function togglePush() {
    const enabled = localStorage.getItem(PUSH_FLAG_KEY) === '1';
    if (enabled) {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch(`${WORKER_URL}/v1/push/${APP_ID}/unsubscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint })
          });
          await sub.unsubscribe();
        }
        localStorage.removeItem(PUSH_FLAG_KEY);
        updatePushUI();
        toast('Notifications disabled', { type: 'info' });
      } catch (err) { toast('Failed to disable push', { type: 'error' }); }
    } else {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        toast('Push not supported', { type: 'warn' }); return;
      }
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') { toast('Permission denied', { type: 'warn' }); return; }
        
        const reg = await navigator.serviceWorker.ready;
        const vapidRes = await fetch(`${WORKER_URL}/v1/push/${APP_ID}/vapid-key`);
        const { key } = await vapidRes.json();
        
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key)
          });
        }
        
        await fetch(`${WORKER_URL}/v1/push/${APP_ID}/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub })
        });
        localStorage.setItem(PUSH_FLAG_KEY, '1');
        updatePushUI();
        toast('Notifications enabled', { type: 'success' });
      } catch (err) {
        toast('Failed to enable push', { type: 'error' });
      }
    }
  }

  /* ---------------------------------------------------------- */
  /* Menu & Keyboard Shortcuts                                   */
  /* ---------------------------------------------------------- */
  const menuBtn = $('#menuBtn');
  const menuDropdown = $('#menuDropdown');
  const menuBackdrop = $('#menuBackdrop');

  function openMenu() {
    menuDropdown.hidden = false;
    menuBackdrop.hidden = false;
    menuBtn.setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    menuDropdown.hidden = true;
    menuBackdrop.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  }

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menuDropdown.hidden ? openMenu() : closeMenu();
  });
  menuBackdrop.addEventListener('click', closeMenu);

  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    if (e.key === 'Escape') {
      closeMenu();
      closeFab();
      if (!$('#viewRoot').hidden) { closeView(); return; }
      closeModal();
    }

    if (state.study) {
      if (e.code === 'Space') {
        e.preventDefault();
        const revealBtn = document.querySelector('#revealBtn');
        const studyCard = document.querySelector('#studyCard');
        if (revealBtn && !revealBtn.hidden) revealBtn.click();
        else if (studyCard) studyCard.click();
      }
      if (['1', '2', '3', '4'].includes(e.key)) {
        const grid = document.querySelector('#ratingGrid');
        if (grid && !grid.hidden) {
          const btn = grid.querySelector(`[data-rating="${Number(e.key)-1}"]`);
          if (btn) btn.click();
        }
      }
    }

    if (e.key.toLowerCase() === 'n' && !$('#viewRoot').hidden && state.currentDeckId && !state.readOnly) {
      openCardForm({});
    }
  });

  $$('.menu-item').forEach((item) => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      closeMenu();
      handleMenuAction(action);
    });
  });

  function handleMenuAction(action) {
    switch (action) {
      case 'search':    openView('search'); break;
      case 'tags':      openView('tags'); break;
      case 'activity':  openView('activity'); break;
      case 'settings':  openView('settings'); break;
      case 'tools':     openToolsSheet(); break;
      case 'backup':    backupToFile(); break;
      case 'restore':   restoreFromFile(); break;
      case 'import-csv': importCSVFromFile(); break;
      case 'export-csv': exportCSV(); break;
      case 'print':     openView('activity'); break;
      case 'clear-data': confirmResetAll(); break;
    }
  }

  /* ---------------------------------------------------------- */
  /* Toast & Confetti                                            */
  /* ---------------------------------------------------------- */
  const toastStack = $('#toastStack');
  const MAX_TOASTS = 3;

  function toast(message, opts = {}) {
    const { icon = 'fa-circle-info', type = 'info', duration = 5000, action = null, persist = false } = opts;
    const existing = $$('.toast', toastStack);
    if (existing.length >= MAX_TOASTS) dismissToast(existing[0]);

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `
      <i class="fa-solid ${icon} toast-icon"></i>
      <span class="toast-msg"></span>
      ${action ? '<button class="toast-action"></button>' : ''}
      <button class="toast-close" aria-label="Dismiss"><i class="fa-solid fa-xmark"></i></button>
    `;
    el.querySelector('.toast-msg').textContent = message;

    if (action) {
      const btn = el.querySelector('.toast-action');
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        action.onClick?.();
        dismissToast(el);
      });
    }

    el.querySelector('.toast-close').addEventListener('click', () => dismissToast(el));
    toastStack.appendChild(el);

    if (!persist && duration > 0) el._timer = setTimeout(() => dismissToast(el), duration);
    return el;
  }

  function dismissToast(el) {
    if (!el || el._dismissed) return;
    el._dismissed = true;
    clearTimeout(el._timer);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 240);
  }

  function fireConfetti() {
    for(let i=0; i<30; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.backgroundColor = ['#E5484D', '#D97706', '#3D9BC9', '#10A96B', '#8B5CF6'][Math.floor(Math.random()*5)];
      c.style.animationDelay = Math.random() * 0.5 + 's';
      c.style.animationDuration = (Math.random() * 1.5 + 1.5) + 's';
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 3000);
    }
  }

  /* ---------------------------------------------------------- */
  /* Modal                                                       */
  /* ---------------------------------------------------------- */
  const modalRoot = $('#modalRoot');
  const modalSlot = $('#modalSlot');
  const modalBackdrop = $('#modalBackdrop');

  function openModal(contentEl) {
    modalSlot.innerHTML = '';
    modalSlot.appendChild(contentEl);
    modalRoot.hidden = false;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('modal-open');
  }
  function closeModal() {
    if (modalRoot.hidden) return;
    modalRoot.hidden = true;
    modalSlot.innerHTML = '';
    document.body.style.overflow = '';
    document.body.classList.remove('modal-open');
  }
  modalBackdrop.addEventListener('click', closeModal);

  /* ---------------------------------------------------------- */
  /* Utilities                                                   */
  /* ---------------------------------------------------------- */
  function escapeHTML(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function relativeTime(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks}w ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function intervalDisplay(days) {
    if (days < 1) return `${Math.round(days * 24)}h`;
    if (days < 30) return `${Math.round(days)}d`;
    return `${Math.round(days / 30)}mo`;
  }

  function dueLabel(card) {
    if (Storage.isMastered(card)) return 'Mastered';
    if (Storage.isBuried(card)) return 'Buried';
    if (Storage.isDue(card)) return 'Due';
    const diff = new Date(card.dueDate).getTime() - Date.now();
    const days = Math.ceil(diff / 86400000);
    if (days <= 1) return 'Due tomorrow';
    return `in ${days}d`;
  }

  function dueLabelClass(card) {
    if (Storage.isMastered(card)) return 'mastered';
    if (Storage.isBuried(card)) return 'future';
    if (Storage.isDue(card)) return 'due';
    return 'future';
  }

  function generateTags(text) {
    if (!text) return [];
    const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
    const stops = ['what', 'this', 'that', 'with', 'from', 'have', 'does', 'your', 'which', 'when', 'where', 'there', 'their', 'about', 'they', 'will', 'would', 'could', 'should'];
    const filtered = words.filter(w => !stops.includes(w));
    if (!filtered.length) return [];
    const counts = {};
    filtered.forEach(w => counts[w] = (counts[w] || 0) + 1);
    return Object.keys(counts).sort((a,b) => counts[b] - counts[a]).slice(0, 2);
  }

  /* ---------------------------------------------------------- */
  /* View system                                                 */
  /* ---------------------------------------------------------- */
  const viewRoot = $('#viewRoot');

  function openView(name, payload = {}) {
    viewRoot.innerHTML = '';
    viewRoot.hidden = false;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('view-open');
    
    if (name === 'deck') {
      const recent = JSON.parse(localStorage.getItem(LS.recentDecks) || '[]');
      const filtered = recent.filter(id => id !== payload.deckId);
      filtered.unshift(payload.deckId);
      localStorage.setItem(LS.recentDecks, JSON.stringify(filtered.slice(0, 3)));
    }

    const el = document.createElement('div');
    el.className = 'view';
    viewRoot.appendChild(el);

    if (name === 'deck')       renderDeckDetail(el, payload.deckId);
    else if (name === 'study') renderStudyView(el, payload);
    else if (name === 'activity') renderActivityView(el);
    else if (name === 'search')   renderSearchView(el);
    else if (name === 'tags')     renderTagsView(el);
    else if (name === 'settings') renderSettingsView(el);
  }

  function closeView() {
    viewRoot.hidden = true;
    viewRoot.innerHTML = '';
    document.body.style.overflow = '';
    document.body.classList.remove('view-open');
    state.currentDeckId = null;
    state.study = null;
    state.bulkMode = false;
    state.selectedCards.clear();
    refresh();
  }

  function viewHeaderHTML(title, rightHTML = '', opts = {}) {
    const backIcon = opts.close ? 'fa-xmark' : 'fa-arrow-left';
    return `
      <div class="view-header">
        <button class="view-back" data-act="back" aria-label="Back">
          <i class="fa-solid ${backIcon}"></i>
        </button>
        <h2 class="view-title">${escapeHTML(title)}</h2>
        <div class="view-actions">${rightHTML}</div>
      </div>`;
  }

  /* ---------------------------------------------------------- */
  /* FAB & Tabs                                                  */
  /* ---------------------------------------------------------- */
  const fabBtn = $('#fabBtn');
  const fabMenu = $('#fabMenu');

  function toggleFab() {
    const willOpen = fabMenu.hidden;
    fabMenu.hidden = !willOpen;
    fabBtn.classList.toggle('open', willOpen);
    fabBtn.setAttribute('aria-expanded', String(willOpen));
  }
  function closeFab() {
    fabMenu.hidden = true;
    fabBtn.classList.remove('open');
    fabBtn.setAttribute('aria-expanded', 'false');
  }

  fabBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFab();
  });

  document.addEventListener('click', (e) => {
    if (!fabMenu.hidden && !e.target.closest('.fab-wrap')) closeFab();
  });

  $$('.fab-item').forEach((item) => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      closeFab();
      if (state.readOnly) return;
      if (action === 'add-card') openCardForm({});
      else if (action === 'new-deck') openDeckForm({});
    });
  });

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const t = tab.dataset.tab;
      state.tab = t;
      $$('.tab').forEach((el) => {
        const active = el.dataset.tab === t;
        el.classList.toggle('active', active);
        el.setAttribute('aria-selected', String(active));
      });
      $$('.screen').forEach((el) => el.classList.toggle('active', el.id === `screen-${t}`));
      renderTab();
    });
  });

  function renderTab() {
    if (state.tab === 'decks') renderDecks();
    else if (state.tab === 'due') renderDue();
  }

  /* ---------------------------------------------------------- */
  /* Home refresh                                                */
  /* ---------------------------------------------------------- */
  function refresh() {
    state.data = state.readOnly ? state.data : Storage.getData();
    const count = Storage.totalDueCount(state.data);
    $('#dueChipCount').textContent = count;
    $('#dueChip').classList.toggle('zero', count === 0);
    renderTab();
  }

  /* ---------------------------------------------------------- */
  /* Decks tab (with Recent Decks)                               */
  /* ---------------------------------------------------------- */
  function renderDecks() {
    const screen = $('#screen-decks');
    const decks = state.data.decks;

    if (!decks.length) {
      screen.innerHTML = emptyStateHTML('decks');
      return;
    }

    screen.innerHTML = '';
    
    const recentIds = JSON.parse(localStorage.getItem(LS.recentDecks) || '[]');
    const recentDecks = recentIds.map(id => decks.find(d => d.id === id)).filter(Boolean);

    if (recentDecks.length > 0) {
      const recentSection = document.createElement('div');
      recentSection.innerHTML = `<div class="section-title">Recently Studied</div>`;
      const recentList = document.createElement('div');
      recentList.className = 'deck-list';
      recentList.style.marginBottom = '24px';
      recentDecks.forEach((deck) => recentList.appendChild(renderDeckCard(deck)));
      screen.appendChild(recentSection);
      screen.appendChild(recentList);
      screen.appendChild(document.createElement('div')).innerHTML = `<div class="section-title">All Decks</div>`;
    }

    const list = document.createElement('div');
    list.className = 'deck-list';
    decks.forEach((deck) => {
      if (recentDecks.length > 0 && recentDecks.includes(deck)) return; // Skip duplicates in "All Decks"
      list.appendChild(renderDeckCard(deck));
    });
    screen.appendChild(list);
  }

  function renderDeckCard(deck) {
    const cards = state.data.cards.filter((c) => c.deckId === deck.id);
    const due = cards.filter(Storage.isDue).length;
    const mastered = cards.filter(Storage.isMastered).length;
    const masteryPct = cards.length ? Math.round((mastered / cards.length) * 100) : 0;

    const card = document.createElement('div');
    card.className = 'deck-card';
    card.dataset.deckId = deck.id;

    card.innerHTML = `
      <div class="deck-top">
        <span class="deck-dot" style="background:${deck.color}"></span>
        <span class="deck-name">${escapeHTML(deck.name)}</span>
        <button class="deck-menu-btn" aria-label="Deck actions"><i class="fa-solid fa-ellipsis"></i></button>
      </div>
      <div class="deck-meta">
        <span class="${due ? 'due-count' : 'due-count zero'}">${due} due</span>
        <span>·</span>
        <span>${cards.length} card${cards.length === 1 ? '' : 's'}</span>
        ${mastered ? `<span>·</span><span>${mastered} mastered</span>` : ''}
      </div>
      <div class="deck-bar"><div class="fill" style="width:${masteryPct}%; background:${deck.color}"></div></div>
      <div class="deck-actions">
        <button class="btn btn-primary" data-act="study">Study</button>
        <button class="btn btn-ghost" data-act="open">Open</button>
      </div>
    `;

    card.querySelector('[data-act="study"]').addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.readOnly) return;
      startStudy({ deckId: deck.id });
    });

    card.querySelector('[data-act="open"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openView('deck', { deckId: deck.id });
    });

    card.querySelector('.deck-menu-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openDeckMenu(deck, e.currentTarget);
    });

    card.addEventListener('click', () => openView('deck', { deckId: deck.id }));

    return card;
  }

  function openDeckMenu(deck, anchor) {
    const menu = document.createElement('div');
    menu.className = 'popover';
    menu.innerHTML = `
      <button data-act="open"><i class="fa-solid fa-folder-open"></i>Open deck</button>
      <button data-act="study"><i class="fa-solid fa-play"></i>Study now</button>
      <button data-act="cram"><i class="fa-solid fa-bolt"></i>Cram mode</button>
      <button data-act="tag"><i class="fa-solid fa-tag"></i>Study by tag…</button>
      <button data-act="edit"><i class="fa-solid fa-pen"></i>Edit deck</button>
      <button data-act="intervals"><i class="fa-solid fa-sliders"></i>Intervals</button>
      <button data-act="reset" class="danger"><i class="fa-solid fa-rotate-left"></i>Reset progress</button>
      <button data-act="delete" class="danger"><i class="fa-solid fa-trash-can"></i>Delete deck</button>
    `;
    const rect = anchor.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.left = `${Math.max(12, rect.right - 200)}px`;
    menu.style.zIndex = 85;
    document.body.appendChild(menu);

    const close = () => menu.remove();
    setTimeout(() => document.addEventListener('click', function h(e) {
      if (!menu.contains(e.target)) { close(); document.removeEventListener('click', h); }
    }), 0);

    menu.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        close();
        const act = b.dataset.act;
        if (act === 'open') openView('deck', { deckId: deck.id });
        else if (act === 'study') startStudy({ deckId: deck.id });
        else if (act === 'cram') startStudy({ deckId: deck.id, mode: 'cram' });
        else if (act === 'tag') openStudyByTagSheet(deck.id);
        else if (act === 'edit') openDeckForm({ deckId: deck.id });
        else if (act === 'intervals') openIntervalsSheet(deck.id);
        else if (act === 'reset') confirmResetDeck(deck);
        else if (act === 'delete') confirmDeleteDeck(deck);
      });
    });
  }

  /* ---------------------------------------------------------- */
  /* Due tab                                                     */
  /* ---------------------------------------------------------- */
  function renderDue() {
    const screen = $('#screen-due');
    const due = Storage.dueCardsOf(state.data);

    if (!due.length) {
      screen.innerHTML = emptyStateHTML('due');
      return;
    }

    const deckCount = new Set(due.map((c) => c.deckId)).size;

    screen.innerHTML = `
      <div class="section-title">${due.length} card${due.length === 1 ? '' : 's'} due · across ${deckCount} deck${deckCount === 1 ? '' : 's'}</div>
      <div style="padding: 0 0 16px;">
        <button class="btn btn-primary btn-block" id="studyAllBtn">
          <i class="fa-solid fa-play"></i> Study all due
        </button>
      </div>
      <div class="deck-list" id="dueList"></div>
    `;

    const list = screen.querySelector('#dueList');
    due.forEach((card) => list.appendChild(renderDueRow(card)));

    screen.querySelector('#studyAllBtn').addEventListener('click', () => {
      if (state.readOnly) return;
      startStudy({ deckId: null });
    });
  }

  function renderDueRow(card) {
    const deck = Storage.getDeck(card.deckId);
    const row = document.createElement('button');
    row.className = 'card-row';
    const displayFront = card.type === 'cloze' ? card.clozeText.replace(/\{\{(?:c\d+::)?([^}]+)\}\}/g, '[$1]') : card.front;
    row.innerHTML = `
      <div class="card-row-body">
        <div class="card-row-front">${escapeHTML(displayFront || 'Empty card')}</div>
        <div class="card-row-meta">
          <span class="tag" style="background: color-mix(in srgb, ${deck?.color || 'var(--accent)'} 18%, transparent); color: ${deck?.color || 'var(--accent)'};">${escapeHTML(deck?.name || 'Unknown')}</span>
        </div>
      </div>
      <span class="card-row-status due">Due</span>
    `;
    row.addEventListener('click', () => {
      if (state.readOnly) return;
      openView('deck', { deckId: card.deckId });
    });
    return row;
  }

  /* ---------------------------------------------------------- */
  /* Empty states                                                */
  /* ---------------------------------------------------------- */
  function emptyStateHTML(kind) {
    if (kind === 'decks') {
      return `
        <div class="empty">
          <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="22" y="30" width="70" height="56" rx="8" stroke="currentColor" stroke-width="3"/>
            <rect x="34" y="42" width="58" height="56" rx="8" stroke="currentColor" stroke-width="3" fill="var(--bg)"/>
            <path d="M46 62h34M46 74h22" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
          </svg>
          <div class="empty-title">No decks yet</div>
          <div class="empty-sub">Tap <strong>+</strong> to create your first deck and start adding cards.</div>
        </div>`;
    }
    if (kind === 'due') {
      return `
        <div class="empty">
          <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="60" cy="60" r="38" stroke="currentColor" stroke-width="3"/>
            <path d="M42 60l12 12 24-24" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="empty-title">All caught up</div>
          <div class="empty-sub">Nothing due right now. Come back later or study a specific deck.</div>
        </div>`;
    }
    if (kind === 'deck-cards') {
      return `
        <div class="empty">
          <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="22" y="30" width="70" height="56" rx="8" stroke="currentColor" stroke-width="3"/>
            <path d="M46 62h34M46 74h22" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
          </svg>
          <div class="empty-title">No cards yet</div>
          <div class="empty-sub">Tap <strong>+</strong> to add your first card to this deck.</div>
        </div>`;
    }
    return '';
  }

  /* ---------------------------------------------------------- */
  /* Deck detail view (with Bulk Mode)                           */
  /* ---------------------------------------------------------- */
  function renderDeckDetail(root, deckId) {
    const deck = Storage.getDeck(deckId);
    if (!deck) { closeView(); return; }
    state.currentDeckId = deckId;

    const cards = Storage.cardsOf(deckId);
    const due = cards.filter(Storage.isDue).length;
    const mastered = cards.filter(Storage.isMastered).length;

    const menuHTML = `
      <button class="icon-btn" data-act="deck-select" aria-label="Select cards" title="Select cards" style="color:${state.bulkMode ? 'var(--accent)' : ''}">
        <i class="fa-solid fa-check-square"></i>
      </button>
      <button class="icon-btn" data-act="deck-intervals" aria-label="Deck intervals" title="Intervals">
        <i class="fa-solid fa-sliders"></i>
      </button>
      <button class="icon-btn" data-act="deck-menu" aria-label="Deck menu">
        <i class="fa-solid fa-ellipsis"></i>
      </button>
    `;

    root.innerHTML = `
      ${viewHeaderHTML(deck.name, menuHTML)}
      <div class="deck-detail-stats">
        <div class="dd-stat"><div class="n due">${due}</div><div class="l">Due</div></div>
        <div class="dd-stat"><div class="n">${cards.length}</div><div class="l">Total</div></div>
        <div class="dd-stat"><div class="n mastered">${mastered}</div><div class="l">Mastered</div></div>
      </div>
      <div class="deck-detail-actions">
        <button class="btn btn-primary btn-block" data-act="study" ${!due || state.readOnly ? 'disabled' : ''}>
          <i class="fa-solid fa-play"></i> ${due ? `Study ${due} due` : 'Nothing due'}
        </button>
      </div>
      <div class="sort-row" id="sortRow">
        <button class="sort-chip active" data-sort="due">Due first</button>
        <button class="sort-chip" data-sort="az">A–Z</button>
        <button class="sort-chip" data-sort="newest">Newest</button>
      </div>
      <div class="view-body" id="deckCardsBody"></div>
      <div class="bulk-bar" id="bulkBar">
        <span class="bulk-bar-count" id="bulkCount">0 selected</span>
        <button class="btn btn-ghost" id="bulkMoveBtn"><i class="fa-solid fa-folder-tree"></i> Move</button>
        <button class="btn btn-ghost" id="bulkBuryBtn"><i class="fa-solid fa-bed"></i> Bury</button>
        <button class="btn btn-danger" id="bulkDeleteBtn"><i class="fa-solid fa-trash-can"></i> Delete</button>
      </div>
    `;

    root.querySelector('[data-act="back"]').addEventListener('click', closeView);
    root.querySelector('[data-act="study"]').addEventListener('click', () => {
      if (state.readOnly || !due) return;
      closeView();
      setTimeout(() => startStudy({ deckId }), 100);
    });

    root.querySelector('[data-act="deck-select"]').addEventListener('click', () => {
      state.bulkMode = !state.bulkMode;
      state.selectedCards.clear();
      root.querySelector('[data-act="deck-select"]').style.color = state.bulkMode ? 'var(--accent)' : '';
      root.querySelector('#bulkBar').classList.toggle('show', state.bulkMode);
      updateBulkBar(root);
      renderDeckCards(root.querySelector('#deckCardsBody'), cards);
    });

    // Bulk Actions Logic
    function updateBulkBar(r) {
      r.querySelector('#bulkCount').textContent = `${state.selectedCards.size} selected`;
    }
    root.querySelector('#bulkMoveBtn').addEventListener('click', () => {
      if (!state.selectedCards.size) return;
      openMoveBulkSheet(Array.from(state.selectedCards));
    });
    root.querySelector('#bulkBuryBtn').addEventListener('click', () => {
      if (!state.selectedCards.size) return;
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(4,0,0,0);
      state.selectedCards.forEach(id => Storage.updateCard(id, { buriedUntil: tomorrow.toISOString() }));
      toast('Buried cards', { type: 'success' });
      state.selectedCards.clear(); updateBulkBar(root);
      renderDeckCards(root.querySelector('#deckCardsBody'), cards);
      refresh();
    });
    root.querySelector('#bulkDeleteBtn').addEventListener('click', () => {
      if (!state.selectedCards.size) return;
      openBulkDeleteConfirm(Array.from(state.selectedCards));
    });

    root.querySelector('[data-act="deck-menu"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openDeckMenu(deck, e.currentTarget);
    });

    root.querySelector('[data-act="deck-intervals"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openIntervalsSheet(deck.id);
    });

    root.querySelectorAll('.sort-chip').forEach((c) => {
      c.addEventListener('click', () => {
        state.sortMode = c.dataset.sort;
        root.querySelectorAll('.sort-chip').forEach((x) => x.classList.toggle('active', x === c));
        renderDeckCards(root.querySelector('#deckCardsBody'), cards);
      });
    });

    renderDeckCards(root.querySelector('#deckCardsBody'), cards);
  }

  function renderDeckCards(container, cards) {
    if (!cards.length) {
      container.innerHTML = emptyStateHTML('deck-cards');
      return;
    }

    const sorted = cards.slice();
    if (state.sortMode === 'due') {
      sorted.sort((a, b) => {
        const aDue = Storage.isDue(a) ? 0 : 1;
        const bDue = Storage.isDue(b) ? 0 : 1;
        if (aDue !== bDue) return aDue - bDue;
        return new Date(a.dueDate) - new Date(b.dueDate);
      });
    } else if (state.sortMode === 'az') {
      sorted.sort((a, b) => (a.front || a.clozeText || '').localeCompare(b.front || b.clozeText || ''));
    } else if (state.sortMode === 'newest') {
      sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    container.innerHTML = '';
    sorted.forEach((card) => container.appendChild(renderCardRow(card)));
    
    const bulkBar = container.parentElement.querySelector('#bulkBar');
    if (bulkBar) {
      container.parentElement.querySelector('#bulkCount').textContent = `${state.selectedCards.size} selected`;
    }
  }

  function renderCardRow(card) {
    const row = document.createElement('button');
    row.className = 'card-row';
    if (state.bulkMode && state.selectedCards.has(card.id)) row.classList.add('selected');

    const displayFront = card.type === 'cloze' 
      ? card.clozeText.replace(/\{\{(?:c\d+::)?([^}]+)\}\}/g, '[$1]') 
      : card.front;

    let typeLabel = '';
    if (card.type === 'cloze') typeLabel = '<span class="tag" style="background:var(--accent-soft); color:var(--accent-deep);">Cloze</span>';
    if (card.type === 'typing') typeLabel = '<span class="tag" style="background:var(--accent-soft); color:var(--accent-deep);">Typing</span>';
    if (card.type === 'reversed') typeLabel = '<span class="tag" style="background:var(--accent-soft); color:var(--accent-deep);">Reversed</span>';
    if (card.failCount >= 5) typeLabel += '<span class="tag" style="background:var(--again); color:#fff;">Leech</span>';

    const tagsHTML = (card.tags || []).map(t => `<span class="tag tag-clickable" data-tag="${escapeHTML(t)}">#${escapeHTML(t)}</span>`).join(' ');

    const statusClass = dueLabelClass(card);
    const statusText = dueLabel(card);

    row.innerHTML = `
      ${state.bulkMode ? `<div class="checkbox-indicator">${state.selectedCards.has(card.id) ? '<i class="fa-solid fa-check" style="font-size:10px;"></i>' : ''}</div>` : ''}
      <div class="card-row-body">
        <div class="card-row-front">${escapeHTML(displayFront || 'Empty card')}</div>
        ${(typeLabel || tagsHTML) ? `<div class="card-row-meta">${typeLabel} ${tagsHTML}</div>` : ''}
      </div>
      <span class="card-row-status ${statusClass}">${escapeHTML(statusText)}</span>
    `;

    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('tag-clickable')) {
        e.stopPropagation();
        const tag = e.target.dataset.tag;
        closeView();
        setTimeout(() => openView('search'), 80);
        setTimeout(() => {
          const inp = document.querySelector('#searchInput');
          if (inp) { inp.value = `#${tag}`; inp.dispatchEvent(new Event('input')); }
        }, 200);
        return;
      }

      if (state.bulkMode) {
        if (state.selectedCards.has(card.id)) state.selectedCards.delete(card.id);
        else state.selectedCards.add(card.id);
        const root = document.getElementById('viewRoot');
        renderDeckCards(root.querySelector('#deckCardsBody'), Storage.cardsOf(state.currentDeckId));
        return;
      }

      if (state.readOnly) return;
      openCardMenu(card, row);
    });

    return row;
  }

  /* ---------------------------------------------------------- */
  /* Bulk Actions Modals                                         */
  /* ---------------------------------------------------------- */
  function openMoveBulkSheet(ids) {
    const card = Storage.getCard(ids[0]);
    if(!card) return;
    const decks = state.data.decks.filter(d => d.id !== card.deckId);
    if (!decks.length) { toast('No other decks available', { type: 'info' }); return; }

    const sheet = document.createElement('div');
    sheet.className = 'modal-sheet';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">Move ${ids.length} Cards</h3>
      <div style="padding: 0 20px 16px; display: flex; flex-direction: column; gap: 8px;">
        ${decks.map(d => `<button class="btn btn-ghost" data-deck="${d.id}">${escapeHTML(d.name)}</button>`).join('')}
      </div>
      <div class="sheet-actions">
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
      </div>
    `;
    openModal(sheet);
    sheet.querySelector('[data-act="cancel"]').addEventListener('click', closeModal);
    sheet.querySelectorAll('[data-deck]').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.deck;
        ids.forEach(id => Storage.updateCard(id, { deckId: targetId }));
        closeModal();
        state.selectedCards.clear();
        state.bulkMode = false;
        refresh();
        closeView();
        toast('Cards moved', { type: 'success' });
      });
    });
  }

  function openBulkDeleteConfirm(ids) {
    const sheet = document.createElement('div');
    sheet.className = 'modal-sheet';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">Delete ${ids.length} cards?</h3>
      <p class="sheet-body">This action cannot be undone.</p>
      <div class="sheet-actions">
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
        <button class="btn btn-danger" data-act="confirm">Delete</button>
      </div>
    `;
    openModal(sheet);
    sheet.querySelector('[data-act="cancel"]').addEventListener('click', closeModal);
    sheet.querySelector('[data-act="confirm"]').addEventListener('click', () => {
      ids.forEach(id => Storage.removeCard(id));
      closeModal();
      state.selectedCards.clear();
      state.bulkMode = false;
      refresh();
      closeView();
      toast('Cards deleted', { type: 'success' });
    });
  }

  /* ---------------------------------------------------------- */
  /* Single Card Menu & Actions                                  */
  /* ---------------------------------------------------------- */
  function openCardMenu(card, anchor) {
    const menu = document.createElement('div');
    menu.className = 'popover';
    menu.innerHTML = `
      <button data-act="edit"><i class="fa-solid fa-pen"></i>Edit card</button>
      <button data-act="bury"><i class="fa-solid fa-bed"></i>${Storage.isBuried(card) ? 'Unbury' : 'Bury until tomorrow'}</button>
      <button data-act="duplicate"><i class="fa-solid fa-copy"></i>Duplicate</button>
      <button data-act="move"><i class="fa-solid fa-folder-tree"></i>Move to deck…</button>
      <button data-act="master"><i class="fa-solid fa-check-double"></i>${Storage.isMastered(card) ? 'Unmark mastered' : 'Mark as mastered'}</button>
      <button data-act="reset"><i class="fa-solid fa-rotate-left"></i>Reset progress</button>
      <button data-act="delete" class="danger"><i class="fa-solid fa-trash-can"></i>Delete card</button>
    `;
    const rect = anchor.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.left = `${Math.max(12, rect.right - 200)}px`;
    menu.style.zIndex = 85;
    document.body.appendChild(menu);

    const close = () => menu.remove();
    setTimeout(() => document.addEventListener('click', function h(e) {
      if (!menu.contains(e.target)) { close(); document.removeEventListener('click', h); }
    }), 0);

    menu.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        close();
        const act = b.dataset.act;
        if (act === 'edit') openCardForm({ cardId: card.id });
        else if (act === 'bury') toggleBury(card);
        else if (act === 'duplicate') duplicateCard(card);
        else if (act === 'move') openMoveCardSheet(card);
        else if (act === 'master') toggleMastered(card);
        else if (act === 'reset') resetCardProgress(card);
        else if (act === 'delete') softDeleteCard(card); 
      });
    });
  }

  function softDeleteCard(card) {
    Storage.removeCard(card.id);
    refresh();
    if (!$('#viewRoot').hidden && state.currentDeckId) {
      const v = $('#viewRoot .view');
      if (v) renderDeckDetail(v, state.currentDeckId);
    }
    toast('Card deleted', { 
      type: 'info', 
      duration: 5000,
      action: { label: 'Undo', onClick: () => { 
        Storage.updateCard(card.id, card); // Put it back
        refresh();
        if (!$('#viewRoot').hidden) {
          const v = $('#viewRoot .view');
          if (v) renderDeckDetail(v, state.currentDeckId);
        }
        toast('Card restored', { type: 'success' });
      }} 
    });
  }

  function toggleBury(card) {
    if (Storage.isBuried(card)) {
      Storage.updateCard(card.id, { buriedUntil: null });
      toast('Unburied', { type: 'success', icon: 'fa-bed' });
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(4, 0, 0, 0); 
      Storage.updateCard(card.id, { buriedUntil: tomorrow.toISOString() });
      toast('Buried until tomorrow', { type: 'success', icon: 'fa-bed' });
    }
    refresh();
    if (!$('#viewRoot').hidden && state.currentDeckId) {
      const view = $('#viewRoot .view');
      if (view) renderDeckDetail(view, state.currentDeckId);
    }
  }

  function duplicateCard(card) {
    Storage.addCard({
      deckId: card.deckId,
      type: card.type,
      front: card.front,
      back: card.back,
      clozeText: card.clozeText,
      tags: [...(card.tags || [])]
    });
    toast('Card duplicated', { type: 'success', icon: 'fa-copy' });
    refresh();
    if (!$('#viewRoot').hidden && state.currentDeckId) {
      const view = $('#viewRoot .view');
      if (view) renderDeckDetail(view, state.currentDeckId);
    }
  }

  function openMoveCardSheet(card) {
    const decks = state.data.decks.filter(d => d.id !== card.deckId);
    if (!decks.length) { toast('No other decks available', { type: 'info' }); return; }

    const sheet = document.createElement('div');
    sheet.className = 'modal-sheet';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">Move Card</h3>
      <div style="padding: 0 20px 16px; display: flex; flex-direction: column; gap: 8px;">
        ${decks.map(d => `<button class="btn btn-ghost" data-deck="${d.id}">${escapeHTML(d.name)}</button>`).join('')}
      </div>
      <div class="sheet-actions">
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
      </div>
    `;
    openModal(sheet);
    sheet.querySelector('[data-act="cancel"]').addEventListener('click', closeModal);
    sheet.querySelectorAll('[data-deck]').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.deck;
        Storage.updateCard(card.id, { deckId: targetId });
        if (card.siblingId) Storage.updateCard(card.siblingId, { deckId: targetId });
        closeModal();
        refresh();
        if (!$('#viewRoot').hidden && state.currentDeckId) {
          const view = $('#viewRoot .view');
          if (view) renderDeckDetail(view, state.currentDeckId);
        }
        toast('Card moved', { type: 'success', icon: 'fa-folder-tree' });
      });
    });
  }

  function toggleMastered(card) {
    Storage.updateCard(card.id, { manuallyMastered: !card.manuallyMastered });
    refresh();
    if (!$('#viewRoot').hidden && state.currentDeckId) {
      const view = $('#viewRoot .view');
      if (view) renderDeckDetail(view, state.currentDeckId);
    }
    toast(card.manuallyMastered ? 'Unmarked' : 'Marked as mastered', { type: 'success', icon: 'fa-check-double' });
  }

  function resetCardProgress(card) {
    Storage.resetCardProgress(card.id);
    refresh();
    toast('Card progress reset', { type: 'success', icon: 'fa-rotate-left' });
  }

  /* ---------------------------------------------------------- */
  /* Study engine (with Cram Timer, Haptics, Swipes)             */
  /* ---------------------------------------------------------- */
  let studyTimerInterval;
  
  function startStudy({ deckId, mode = 'normal', tag = null }) {
    let cards = state.data.cards.filter(c => !deckId || c.deckId === deckId);
    
    if (mode === 'normal') cards = cards.filter(Storage.isDue);
    else if (mode === 'tag') cards = cards.filter(c => (c.tags || []).includes(tag));

    cards = cards.sort(() => Math.random() - 0.5);

    if (!cards.length) { 
      toast(mode === 'cram' ? 'Deck is empty' : 'Nothing due to study', { type: 'info', icon: 'fa-circle-info' }); 
      return; 
    }

    state.study = {
      deckId, mode, tag,
      queue: cards.map((c) => c.id),
      index: 0,
      flipped: false,
      typedChecked: false,
      timerStart: Date.now()
    };
    openView('study', { deckId });
    
    clearInterval(studyTimerInterval);
    if (mode === 'cram') {
      studyTimerInterval = setInterval(() => {
        const el = document.getElementById('cramTimer');
        if (el) {
          const diff = Math.floor((Date.now() - state.study.timerStart) / 1000);
          const m = Math.floor(diff/60).toString().padStart(2, '0');
          const s = (diff%60).toString().padStart(2, '0');
          el.textContent = `${m}:${s}`;
        }
      }, 1000);
    }
  }

  function renderStudyView(root, payload) {
    if (!state.study) { closeView(); return; }
    const { deckId, mode } = state.study;
    const deck = deckId ? Storage.getDeck(deckId) : null;

    root.innerHTML = `
      <div class="study-wrap">
        <div class="study-head">
          <button class="view-back" data-act="exit" aria-label="Exit study">
            <i class="fa-solid fa-xmark"></i>
          </button>
          <div class="study-deck-name">${escapeHTML(deck ? deck.name : 'All due cards')}</div>
          <div class="study-counter" id="studyCounter"></div>
        </div>
        ${mode === 'cram' ? `<div style="text-align:center;font-family:monospace;font-size:14px;color:var(--warn);margin-bottom:10px;"><i class="fa-solid fa-stopwatch"></i> <span id="cramTimer">00:00</span></div>` : ''}
        <div class="study-progress"><div class="fill" id="studyProgressFill"></div></div>
        <div class="study-card" id="studyCard">
          <div class="study-front" id="studyFront"></div>
          <div class="study-back" id="studyBack"></div>
          <div class="study-tags" id="studyTags"></div>
        </div>
        <div class="study-hint" id="studyHint">Tap the card to reveal the answer</div>
        <div class="study-actions" id="studyActions">
          <button class="reveal-btn" id="revealBtn">Reveal answer</button>
          <div class="rating-grid" id="ratingGrid" hidden></div>
          <button class="skip-btn" id="skipBtn">Skip for now</button>
        </div>
      </div>
    `;

    root.querySelector('[data-act="exit"]').addEventListener('click', () => {
      clearInterval(studyTimerInterval);
      state.study = null;
      closeView();
    });

    root.querySelector('#skipBtn').addEventListener('click', () => {
      if (!state.study) return;
      const cur = state.study.queue.splice(state.study.index, 1)[0];
      state.study.queue.push(cur);
      state.study.flipped = false;
      state.study.typedChecked = false;
      renderStudyCard(root);
    });

    renderStudyCard(root);
  }

  function renderStudyCard(root) {
    if (!state.study) { closeView(); return; }
    const s = state.study;

    if (s.index >= s.queue.length) {
      clearInterval(studyTimerInterval);
      fireConfetti();
      root.querySelector('.study-wrap').innerHTML = `
        <div class="study-complete">
          <div class="icon"><i class="fa-solid fa-check"></i></div>
          <h2>All done for now</h2>
          <p>You reviewed every card in this session.</p>
          <button class="btn btn-primary" style="margin-top:12px;" id="doneBtn">Back to decks</button>
        </div>
      `;
      root.querySelector('#doneBtn').addEventListener('click', () => {
        state.study = null;
        closeView();
      });
      return;
    }

    const card = state.data.cards.find((c) => c.id === s.queue[s.index]);
    if (!card) { s.index++; renderStudyCard(root); return; }

    const deck = Storage.getDeck(card.deckId);
    const intervals = deck ? deck.intervals : Storage.DEFAULT_INTERVALS;

    const frontEl = root.querySelector('#studyFront');
    const backEl = root.querySelector('#studyBack');
    const tagsEl = root.querySelector('#studyTags');
    const hintEl = root.querySelector('#studyHint');
    const revealBtn = root.querySelector('#revealBtn');
    const ratingGrid = root.querySelector('#ratingGrid');
    const skipBtn = root.querySelector('#skipBtn');
    const studyCardEl = root.querySelector('#studyCard');

    backEl.classList.remove('show');
    tagsEl.innerHTML = '';
    hintEl.hidden = false;
    revealBtn.hidden = false;
    ratingGrid.hidden = true;
    ratingGrid.innerHTML = '';
    skipBtn.hidden = false;
    studyCardEl.onclick = null;

    if (card.tags && card.tags.length) {
      tagsEl.innerHTML = card.tags.map((t) => `<span class="tag">#${escapeHTML(t)}</span>`).join('');
      tagsEl.style.display = 'flex';
    } else {
      tagsEl.style.display = 'none';
    }

    // SWIPE LOGIC
    let touchStartX = 0;
    studyCardEl.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, {passive: true});
    studyCardEl.addEventListener('touchend', e => {
      if (!studyCardEl.contains(e.target)) return;
      const touchEndX = e.changedTouches[0].screenX;
      const delta = touchEndX - touchStartX;
      if (delta < -50) { // Swipe Left
        if (s.flipped || s.typedChecked) { rateCard(root, 0); if(navigator.vibrate) navigator.vibrate(20); }
      } else if (delta > 50) { // Swipe Right
        if (!s.flipped && card.type !== 'typing') studyCardEl.click();
        else if (s.flipped || s.typedChecked) { rateCard(root, 2); if(navigator.vibrate) navigator.vibrate(20); }
      }
    }, {passive: true});
    // END SWIPE LOGIC

    if (card.type === 'cloze') {
      const regex = /\{\{(?:c\d+::)?([^}]+)\}\}/g;
      if (s.flipped) {
        frontEl.innerHTML = card.clozeText.replace(regex, (_, ans) => `<span class="study-cloze-answer">${escapeHTML(ans)}</span>`);
      } else {
        frontEl.innerHTML = card.clozeText.replace(regex, (_, ans) => `<span class="study-cloze-blank">${'_'.repeat(Math.min(ans.length, 8))}</span>`);
      }
      studyCardEl.onclick = () => {
        if (s.flipped) return;
        s.flipped = true;
        renderStudyCard(root);
      };
    } else if (card.type === 'typing') {
      frontEl.textContent = card.front;
      hintEl.hidden = true;
      revealBtn.hidden = true;
      
      if (!s.typedChecked) {
        ratingGrid.hidden = false;
        ratingGrid.style.display = 'flex';
        ratingGrid.style.flexDirection = 'column';
        ratingGrid.innerHTML = `
          <input type="text" id="typingInput" class="study-typing-input" placeholder="Type your answer..." autocomplete="off">
          <button class="btn btn-primary" id="checkBtn" style="margin-top:10px;">Check</button>
        `;
        const input = ratingGrid.querySelector('#typingInput');
        input.focus();
        
        const doCheck = () => {
          if (!input.value.trim()) return;
          const val = input.value.trim().toLowerCase().replace(/[.,!?;:'"]/g, '');
          const ans = card.back.trim().toLowerCase().replace(/[.,!?;:'"]/g, '');
          s.typedChecked = true;
          s.flipped = true;
          backEl.textContent = card.back;
          backEl.classList.add('show');
          
          if (val === ans) toast('Correct!', { type: 'success', icon: 'fa-check' });
          else toast('Incorrect', { type: 'error', icon: 'fa-xmark' });
          
          renderStudyCard(root);
        };
        
        input.addEventListener('keydown', e => { if(e.key==='Enter') doCheck(); });
        ratingGrid.querySelector('#checkBtn').addEventListener('click', doCheck);
      } else {
        backEl.textContent = card.back;
        backEl.classList.add('show');
        showRatingGrid();
      }
    } else {
      frontEl.textContent = card.front;
      backEl.textContent = card.back;
      studyCardEl.onclick = () => {
        if (s.flipped) return;
        s.flipped = true;
        backEl.classList.add('show');
        hintEl.hidden = true;
        revealBtn.hidden = true;
        showRatingGrid();
      };
    }

    if (!s.flipped && card.type !== 'typing') {
       revealBtn.onclick = (e) => { e.stopPropagation(); studyCardEl.click(); };
    }

    function showRatingGrid() {
      revealBtn.hidden = true;
      ratingGrid.hidden = false;
      ratingGrid.style.display = 'grid';
      ratingGrid.style.flexDirection = '';
      ratingGrid.innerHTML = RATING_LABELS.map((label, i) => `
        <button class="rate-btn rate-${RATING_CLASSES[i]}" data-rating="${i}">
          ${label}
          <span class="interval">${intervalDisplay(intervals[i])}</span>
        </button>
      `).join('');
      
      ratingGrid.querySelectorAll('.rate-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          rateCard(root, Number(btn.dataset.rating));
        });
      });
    }

    root.querySelector('#studyCounter').textContent = `${s.index + 1} / ${s.queue.length}`;
    root.querySelector('#studyProgressFill').style.width = `${(s.index / s.queue.length) * 100}%`;
  }

  function rateCard(root, rating) {
    const s = state.study;
    const card = s.queue ? state.data.cards.find((c) => c.id === s.queue[s.index]) : null;
    if (!card) return;
    
    if (navigator.vibrate) navigator.vibrate(10); // Haptic feedback
    
    Storage.rateCard(card.id, rating);
    state.data = Storage.getData();
    s.index++;
    s.flipped = false;
    s.typedChecked = false;
    renderStudyCard(root);
  }

  /* ---------------------------------------------------------- */
  /* Activity view                                               */
  /* ---------------------------------------------------------- */
  function renderActivityView(root) {
    const data = state.data;
    const total = data.cards.length;
    const due = Storage.totalDueCount(data);
    const mastered = Storage.masteredCount(data);
    const streak = Storage.streak(data);

    let totalReviews = 0, correctReviews = 0, leeches = 0;
    data.cards.forEach(c => { if (c.failCount >= 5) leeches++; });
    (data.reviews || []).forEach(r => {
      totalReviews++;
      if (r.rating >= 2) correctReviews++;
    });
    const retention = totalReviews ? Math.round((correctReviews / totalReviews) * 100) : 0;

    root.innerHTML = `
      ${viewHeaderHTML('Activity')}
      <div class="view-body">
        <div class="stats-grid">
          <div class="stat-tile"><div class="n">${total}</div><div class="l"><i class="fa-solid fa-clone"></i>Total cards</div></div>
          <div class="stat-tile warn"><div class="n">${due}</div><div class="l"><i class="fa-solid fa-bolt"></i>Due now</div></div>
          <div class="stat-tile success"><div class="n">${mastered}</div><div class="l"><i class="fa-solid fa-check-double"></i>Mastered</div></div>
          <div class="stat-tile"><div class="n">${streak}<small>d</small></div><div class="l"><i class="fa-solid fa-fire"></i>Streak</div></div>
          <div class="stat-tile"><div class="n">${retention}%</div><div class="l"><i class="fa-solid fa-brain"></i>Retention</div></div>
          <div class="stat-tile"><div class="n">${leeches}</div><div class="l"><i class="fa-solid fa-bug"></i>Leeches</div></div>
        </div>

        <section class="activity-section">
          <div class="activity-section-title">Last 90 days</div>
          <div class="heatmap-wrap">
            <div class="heatmap" id="heatmap"></div>
            <div class="heatmap-legend">
              <span>Less</span><span class="heat-cell lvl-0"></span><span class="heat-cell lvl-1"></span><span class="heat-cell lvl-2"></span><span class="heat-cell lvl-3"></span><span class="heat-cell lvl-4"></span><span>More</span>
            </div>
          </div>
        </section>

        <section class="activity-section">
          <div class="activity-section-title">Review history</div>
          <div class="activity-feed" id="activityFeed"></div>
        </section>
      </div>
    `;

    root.querySelector('[data-act="back"]').addEventListener('click', closeView);
    renderHeatmap(root.querySelector('#heatmap'));
    renderActivityFeed(root.querySelector('#activityFeed'));
  }

  function renderHeatmap(container) {
    const { counts } = Storage.heatmapData(state.data, 90);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(today); start.setDate(start.getDate() - 89); start.setDate(start.getDate() - start.getDay());

    const cells = [];
    const cursor = new Date(start);
    while (cursor <= today) {
      const k = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      const n = counts[k] || 0;
      let lvl = 0;
      if (n >= 1 && n <= 3) lvl = 1;
      else if (n >= 4 && n <= 8) lvl = 2;
      else if (n >= 9 && n <= 15) lvl = 3;
      else if (n >= 16) lvl = 4;
      cells.push(`<span class="heat-cell lvl-${lvl}" title="${cursor.toDateString()} — ${n} review${n === 1 ? '' : 's'}"></span>`);
      cursor.setDate(cursor.getDate() + 1);
    }
    container.innerHTML = cells.join('');
  }

  function renderActivityFeed(container) {
    const reviews = (state.data.reviews || []).slice().reverse();
    if (!reviews.length) {
      container.innerHTML = `<div class="search-hint"><i class="fa-solid fa-clock-rotate-left"></i><div class="search-hint-title">No reviews yet</div><div class="search-hint-sub">Study a deck to see your review history here.</div></div>`;
      return;
    }
    const groups = new Map();
    reviews.slice(0, 200).forEach((r) => {
      const d = new Date(r.at);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    });

    container.innerHTML = '';
    groups.forEach((entries) => {
      const day = document.createElement('div');
      day.innerHTML = `<div class="feed-day-label">${escapeHTML(dayLabel(entries[0].at))}</div>`;
      entries.forEach((r) => {
        const card = state.data.cards.find((c) => c.id === r.cardId);
        const deck = state.data.decks.find((d) => d.id === r.deckId);
        if (!card) return;
        const time = new Date(r.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        const entry = document.createElement('div');
        entry.className = 'feed-entry';
        entry.innerHTML = `
          <span class="dot" style="background:${deck?.color || 'var(--accent)'}"></span>
          <div class="feed-body">
            <div class="feed-title">${escapeHTML(card.front || card.clozeText || 'Card')}</div>
            <div class="feed-sub">${escapeHTML(deck?.name || 'Unknown')} · ${time}</div>
          </div>
          <span class="feed-rating rating-${RATING_CLASSES[r.rating]}">${RATING_LABELS[r.rating]}</span>
        `;
        day.appendChild(entry);
      });
      container.appendChild(day);
    });
  }

  function dayLabel(iso) {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(d, today)) return 'Today';
    if (same(d, yesterday)) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }

  /* ---------------------------------------------------------- */
  /* Search view                                                 */
  /* ---------------------------------------------------------- */
  function renderSearchView(root) {
    root.innerHTML = `
      <div class="view-header view-header-search">
        <button class="view-back" data-act="back" aria-label="Back"><i class="fa-solid fa-arrow-left"></i></button>
        <div class="search-wrap">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input type="text" id="searchInput" placeholder="Search cards, decks, tags…" autocomplete="off" spellcheck="false">
          <button class="search-clear" id="searchClear" hidden aria-label="Clear"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>
      <div class="view-body" id="searchResults"></div>
    `;
    root.querySelector('[data-act="back"]').addEventListener('click', closeView);

    const input = root.querySelector('#searchInput');
    const clearBtn = root.querySelector('#searchClear');
    const results = root.querySelector('#searchResults');

    setTimeout(() => input.focus(), 100);

    function render() {
      const q = input.value.trim().toLowerCase();
      clearBtn.hidden = !q;

      if (!q) {
        results.innerHTML = `<div class="search-hint"><i class="fa-solid fa-magnifying-glass"></i><div class="search-hint-title">Search your cards</div><div class="search-hint-sub">Find by front, back, or tags. Use <strong>#tag</strong> for tag-only matches.</div></div>`;
        return;
      }

      const isTag = q.startsWith('#');
      const term = isTag ? q.slice(1) : q;
      const matches = [];
      state.data.cards.forEach((c) => {
        const deck = Storage.getDeck(c.deckId);
        const tags = c.tags || [];
        let hit = false;
        if (isTag) hit = tags.some((t) => t.toLowerCase().includes(term));
        else hit = (c.front || '').toLowerCase().includes(term)
              || (c.back || '').toLowerCase().includes(term)
              || (c.clozeText || '').toLowerCase().includes(term)
              || tags.some((t) => t.toLowerCase().includes(term))
              || (deck?.name || '').toLowerCase().includes(term);
        if (hit) matches.push({ card: c, deck });
      });

      if (!matches.length) {
        results.innerHTML = `<div class="search-hint"><i class="fa-solid fa-face-frown"></i><div class="search-hint-title">No matches</div><div class="search-hint-sub">Nothing found for "<strong>${escapeHTML(q)}</strong>".</div></div>`;
        return;
      }

      results.innerHTML = `<div class="search-label">${matches.length} result${matches.length === 1 ? '' : 's'}</div>`;
      matches.slice(0, 100).forEach(({ card, deck }) => {
        const row = document.createElement('button');
        row.className = 'card-row';
        const statusClass = dueLabelClass(card);
        const statusText = dueLabel(card);
        const displayFront = card.type === 'cloze' ? card.clozeText.replace(/\{\{(?:c\d+::)?([^}]+)\}\}/g, '[$1]') : card.front;
        const tagsHTML = (card.tags || []).slice(0, 2).map((t) => `<span class="tag">#${escapeHTML(t)}</span>`).join('');
        row.innerHTML = `
          <div class="card-row-body">
            <div class="card-row-front">${highlight(displayFront, term)}</div>
            <div class="card-row-meta">
              <span class="tag" style="background: color-mix(in srgb, ${deck?.color || 'var(--accent)'} 18%, transparent); color: ${deck?.color || 'var(--accent)'};">${escapeHTML(deck?.name || '')}</span>
              ${tagsHTML}
            </div>
          </div>
          <span class="card-row-status ${statusClass}">${escapeHTML(statusText)}</span>
        `;
        row.addEventListener('click', () => {
          if (state.readOnly) return;
          openCardForm({ cardId: card.id });
        });
        results.appendChild(row);
      });
    }

    function highlight(text, query) {
      const t = String(text || '');
      if (!query) return escapeHTML(t);
      const idx = t.toLowerCase().indexOf(query.toLowerCase());
      if (idx === -1) return escapeHTML(t);
      return escapeHTML(t.slice(0, idx)) + '<mark>' + escapeHTML(t.slice(idx, idx + query.length)) + '</mark>' + escapeHTML(t.slice(idx + query.length));
    }

    input.addEventListener('input', render);
    clearBtn.addEventListener('click', () => { input.value = ''; input.focus(); render(); });
    render();
  }

  /* ---------------------------------------------------------- */
  /* Tags view                                                   */
  /* ---------------------------------------------------------- */
  function renderTagsView(root) {
    const counts = {};
    state.data.cards.forEach((c) => {
      (c.tags || []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; });
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    root.innerHTML = `
      ${viewHeaderHTML('Tags')}
      <div class="view-body">
        ${sorted.length ? sorted.map(([tag, n]) => `
          <button class="tag-row" data-tag="${escapeHTML(tag)}">
            <span class="tag-row-name">#${escapeHTML(tag)}</span>
            <span class="tag-row-count">${n} card${n === 1 ? '' : 's'}</span>
          </button>
        `).join('') : `<div class="search-hint"><i class="fa-solid fa-tag"></i><div class="search-hint-title">No tags yet</div><div class="search-hint-sub">Add tags to cards to organize them across decks.</div></div>`}
      </div>
    `;

    root.querySelector('[data-act="back"]').addEventListener('click', closeView);
    root.querySelectorAll('.tag-row').forEach((row) => {
      row.addEventListener('click', () => {
        closeView();
        setTimeout(() => openView('search'), 80);
        setTimeout(() => {
          const inp = document.querySelector('#searchInput');
          if (inp) { inp.value = `#${row.dataset.tag}`; inp.dispatchEvent(new Event('input')); }
        }, 200);
      });
    });
  }

  /* ---------------------------------------------------------- */
  /* Settings view (Cleaned up)                                  */
  /* ---------------------------------------------------------- */
  function renderSettingsView(root) {
    const currentFamily = getFamily();
    const currentMode = getMode();

    const themeButtons = THEME_FAMILIES.map((t) => `
      <button class="theme-btn-clean ${t.id === currentFamily ? 'active' : ''}" data-family-id="${t.id}">
        <span style="width:12px;height:12px;border-radius:50%;background:linear-gradient(135deg, ${t.c1} 50%, ${t.c2} 50%);display:inline-block;"></span>
        ${escapeHTML(t.name)}
      </button>
    `).join('');

    const ro = state.readOnly;
    const lastSync = localStorage.getItem(SYNC_TIME_KEY);

    root.innerHTML = `
      ${viewHeaderHTML('Settings')}
      <div class="view-body">
        
        <section class="settings-section">
          <div class="settings-section-title">Appearance</div>
          <div class="appearance-clean">${themeButtons}</div>
          <div class="settings-section-hint" style="padding-top:6px;">Tap a family to switch palettes. Sun/moon in the header flips light/dark.</div>
        </section>

        ${!ro ? `
        <section class="settings-section">
          <div class="settings-section-title">Sync & Notifications</div>
          <div class="settings-card">
            <div class="drive-block">
              <label class="drive-field">
                <span class="drive-field-label">Sync Token</span>
                <input type="password" id="syncTokenInput" value="${localStorage.getItem(SYNC_TOKEN_KEY) || DEFAULT_SYNC_TOKEN}" autocomplete="off">
              </label>
              <div class="drive-actions">
                <button class="drive-btn primary" id="syncNowBtn"><i class="fa-solid fa-rotate"></i><span>Sync Now</span></button>
                <button class="drive-btn" id="enablePushBtn"><i class="fa-solid fa-bell"></i><span>Enable Notifications</span></button>
              </div>
              <div class="drive-status" id="syncStatusBox">${lastSync ? 'Last synced ' + relativeTime(lastSync) : 'Not synced yet'}</div>
            </div>
          </div>
        </section>
        ` : ''}

        <section class="settings-section">
          <div class="settings-section-title">About</div>
          <div class="settings-card">
            <div class="settings-row static">
              <i class="fa-solid fa-code-branch"></i>
              <div class="settings-row-text">
                <div class="settings-row-title">Version</div>
                <div class="settings-row-sub" id="appVersion">Loading…</div>
              </div>
            </div>
          </div>
        </section>

        ${!ro ? `
        <section class="settings-section">
          <div class="settings-section-title">Danger zone</div>
          <div class="settings-card">
            <button class="settings-row danger" id="resetAllRow">
              <i class="fa-solid fa-triangle-exclamation"></i>
              <div class="settings-row-text">
                <div class="settings-row-title">Reset all data</div>
                <div class="settings-row-sub">Permanently delete every deck, card, and review</div>
              </div>
              <i class="fa-solid fa-chevron-right settings-row-chevron"></i>
            </button>
          </div>
        </section>
        ` : ''}

        <div class="settings-footer">CjayCards · Spaced Repetition</div>
      </div>
    `;

    root.querySelector('[data-act="back"]').addEventListener('click', closeView);

    getAppVersion().then((v) => {
      const el = root.querySelector('#appVersion');
      if (el) el.textContent = v;
    });

    root.querySelectorAll('.theme-btn-clean').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.familyId;
        applyTheme(id, getMode());
        persistTheme(id, getMode());
        root.querySelectorAll('.theme-btn-clean').forEach((c) => c.classList.toggle('active', c.dataset.familyId === id));
      });
    });

    const syncTokenInput = root.querySelector('#syncTokenInput');
    if (syncTokenInput) {
      syncTokenInput.addEventListener('change', () => {
        localStorage.setItem(SYNC_TOKEN_KEY, syncTokenInput.value.trim());
        toast('Token saved', { type: 'success' });
      });
      root.querySelector('#syncNowBtn').addEventListener('click', () => syncToWorker());
      root.querySelector('#enablePushBtn').addEventListener('click', togglePush);
      updatePushUI();
    }

    const resetRow = root.querySelector('#resetAllRow');
    if (resetRow) {
      resetRow.addEventListener('click', () => { closeView(); setTimeout(confirmResetAll, 100); });
    }
  }

  async function getAppVersion() {
    try {
      const res = await fetch(`sw.js?t=${Date.now()}`, { cache: 'no-store' });
      const text = await res.text();
      const m = text.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
      return m ? `v${m[1].replace(/^v/, '')}` : 'unknown';
    } catch { return 'unknown'; }
  }

  /* ---------------------------------------------------------- */
  /* Deck form                                                   */
  /* ---------------------------------------------------------- */
  function openDeckForm({ deckId = null } = {}) {
    const editing = deckId ? Storage.getDeck(deckId) : null;
    let color = editing?.color || Storage.DECK_COLORS[0];

    const sheet = document.createElement('div');
    sheet.className = 'modal-sheet';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">${editing ? 'Edit deck' : 'New deck'}</h3>
      <label class="field">
        <span class="field-label">Deck name</span>
        <input type="text" id="fName" placeholder="e.g. Anatomy" value="${editing ? escapeHTML(editing.name) : ''}" autocomplete="off">
      </label>
      <div class="field">
        <span class="field-label">Color</span>
        <div class="color-row" id="colorRow">
          ${Storage.DECK_COLORS.map((c) => `
            <button type="button" class="color-swatch ${c === color ? 'active' : ''}" data-color="${c}" style="background:${c}"></button>
          `).join('')}
        </div>
      </div>
      <div class="sheet-actions">
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
        <button class="btn btn-primary" data-act="save">${editing ? 'Save' : 'Create'}</button>
      </div>
    `;
    openModal(sheet);

    const nameInput = sheet.querySelector('#fName');
    const colorRow = sheet.querySelector('#colorRow');

    colorRow.querySelectorAll('.color-swatch').forEach((s) => {
      s.addEventListener('click', () => {
        colorRow.querySelectorAll('.color-swatch').forEach((x) => x.classList.remove('active'));
        s.classList.add('active');
        color = s.dataset.color;
      });
    });

    sheet.querySelector('[data-act="cancel"]').addEventListener('click', closeModal);
    sheet.querySelector('[data-act="save"]').addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      if (editing) {
        Storage.updateDeck(editing.id, { name, color });
        toast('Deck updated', { type: 'success', icon: 'fa-check' });
      } else {
        Storage.addDeck({ name, color });
        toast('Deck created', { type: 'success', icon: 'fa-plus' });
      }
      closeModal();
      refresh();
    });

    setTimeout(() => nameInput.focus(), 200);
  }

  /* ---------------------------------------------------------- */
  /* Card form (with Auto-Tag)                                   */
  /* ---------------------------------------------------------- */
  function openCardForm({ cardId = null, deckId = null } = {}) {
    const editing = cardId ? Storage.getCard(cardId) : null;
    let actualEditing = editing;
    if (editing && editing.type === 'reversed' && editing.siblingId) {
      actualEditing = Storage.getCard(editing.siblingId) || editing;
    }

    const decks = state.data.decks;
    if (!decks.length) {
      toast('Create a deck first', { type: 'warn', icon: 'fa-triangle-exclamation' });
      return;
    }

    let currentDeckId = actualEditing?.deckId || deckId || state.currentDeckId || decks[0].id;
    const type = actualEditing?.type || 'basic';
    const isReversed = !!(actualEditing && actualEditing.type === 'basic' && actualEditing.siblingId);
    const clozeText = actualEditing?.clozeText || '';

    const sheet = document.createElement('div');
    sheet.className = 'modal-sheet';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">${actualEditing ? 'Edit card' : 'Add card'}</h3>

      <label class="field">
        <span class="field-label">Deck</span>
        <div class="search-wrap" style="height:auto; padding:10px 14px;">
          <select id="fDeck" style="border:none; background:transparent; color:var(--text); font:inherit; font-size:14.5px; width:100%;">
            ${decks.map((d) => `<option value="${d.id}" ${d.id === currentDeckId ? 'selected' : ''}>${escapeHTML(d.name)}</option>`).join('')}
          </select>
        </div>
      </label>

      <label class="field">
        <span class="field-label">Card Type</span>
        <div class="search-wrap" style="height:auto; padding:10px 14px;">
          <select id="fType" style="border:none; background:transparent; color:var(--text); font:inherit; font-size:14.5px; width:100%;">
            <option value="basic" ${type === 'basic' ? 'selected' : ''}>Basic (Front → Back)</option>
            <option value="typing" ${type === 'typing' ? 'selected' : ''}>Typing (Type the answer)</option>
            <option value="cloze" ${type === 'cloze' ? 'selected' : ''}>Cloze (Fill in the blank)</option>
          </select>
        </div>
      </label>

      <div id="basicFields" ${type === 'cloze' ? 'style="display:none"' : ''}>
        <label class="field">
          <span class="field-label">Front</span>
          <textarea id="fFront" placeholder="Question or prompt…">${actualEditing ? escapeHTML(actualEditing.front) : ''}</textarea>
        </label>
        <label class="field">
          <span class="field-label">Back</span>
          <textarea id="fBack" placeholder="Answer…">${actualEditing ? escapeHTML(actualEditing.back) : ''}</textarea>
        </label>
        <label class="field" style="display:flex; align-items:center; gap:8px; margin-top:16px; cursor:pointer;">
          <input type="checkbox" id="fReverse" ${isReversed ? 'checked' : ''} style="width:18px; height:18px;">
          <span class="field-label" style="margin:0;">Also reverse (Back → Front)</span>
        </label>
      </div>

      <div id="clozeFields" ${type !== 'cloze' ? 'style="display:none"' : ''}>
        <label class="field">
          <span class="field-label">Cloze Text</span>
          <textarea id="fCloze" placeholder="The capital of France is {{c1::Paris}}." style="min-height:100px;">${escapeHTML(clozeText)}</textarea>
          <span class="field-hint">Wrap hidden parts in {{c1::answer}}.</span>
        </label>
      </div>

      <label class="field">
        <span class="field-label">Tags <span class="opt">(comma-separated)</span></span>
        <div style="display:flex; gap:8px;">
          <input type="text" id="fTags" placeholder="e.g. high-yield, exam" value="${actualEditing && actualEditing.tags ? actualEditing.tags.join(', ') : ''}" style="flex:1;">
          <button class="btn btn-ghost" id="autoTagBtn" title="Auto-generate tags" style="padding:0 12px;"><i class="fa-solid fa-wand-magic-sparkles" style="color:var(--accent);"></i></button>
        </div>
      </label>

      <div class="sheet-actions ${actualEditing ? '' : ''}">
        ${actualEditing ? '<button class="btn btn-danger-ghost" data-act="delete"><i class="fa-solid fa-trash-can"></i></button>' : ''}
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
        <button class="btn btn-primary" data-act="save">${actualEditing ? 'Save' : 'Add'}</button>
      </div>
    `;
    openModal(sheet);

    const typeSelect = sheet.querySelector('#fType');
    typeSelect.addEventListener('change', () => {
      const v = typeSelect.value;
      sheet.querySelector('#basicFields').style.display = v === 'cloze' ? 'none' : 'block';
      sheet.querySelector('#clozeFields').style.display = v === 'cloze' ? 'block' : 'none';
    });

    const frontInput = sheet.querySelector('#fFront');
    const backInput = sheet.querySelector('#fBack');
    const clozeInput = sheet.querySelector('#fCloze');
    const tagsInput = sheet.querySelector('#fTags');
    const deckSelect = sheet.querySelector('#fDeck');
    
    sheet.querySelector('#autoTagBtn').addEventListener('click', () => {
      const text = typeSelect.value === 'cloze' ? clozeInput.value : frontInput.value + ' ' + backInput.value;
      const auto = generateTags(text);
      if (auto.length) {
        const current = tagsInput.value.split(',').map(t=>t.trim()).filter(Boolean);
        const merged = [...new Set([...current, ...auto])].join(', ');
        tagsInput.value = merged;
        toast('Tags generated', { type: 'success', icon: 'fa-wand-magic-sparkles' });
      } else {
        toast('Not enough text to generate tags', { type: 'warn' });
      }
    });

    sheet.querySelector('[data-act="cancel"]').addEventListener('click', closeModal);
    sheet.querySelector('[data-act="save"]').addEventListener('click', () => {
      const fType = typeSelect.value;
      const front = frontInput.value.trim();
      const back = backInput.value.trim();
      const fCloze = clozeInput.value.trim();
      const tags = tagsInput.value.split(',').map((t) => t.trim()).filter(Boolean);
      const targetDeckId = deckSelect.value;
      const reverse = sheet.querySelector('#fReverse').checked;

      if (fType === 'cloze') {
        if (!fCloze || !fCloze.includes('{{')) { toast('Add at least one {{c1::answer}} marker', { type: 'warn' }); return; }
        if (actualEditing) {
          Storage.updateCard(actualEditing.id, { type: 'cloze', clozeText: fCloze, tags, deckId: targetDeckId });
        } else {
          Storage.addCard({ deckId: targetDeckId, type: 'cloze', clozeText: fCloze, tags });
        }
      } else {
        if (!front || !back) { toast('Front and back required', { type: 'warn' }); return; }
        
        if (actualEditing) {
          const updates = { type: fType, front, back, tags, deckId: targetDeckId };
          Storage.updateCard(actualEditing.id, updates);
          
          if (reverse && !actualEditing.siblingId) {
            const sib = Storage.addCard({ deckId: targetDeckId, type: 'reversed', front: back, back: front, tags, siblingId: actualEditing.id });
            Storage.updateCard(actualEditing.id, { siblingId: sib.id });
          } else if (!reverse && actualEditing.siblingId) {
            Storage.removeCard(actualEditing.siblingId);
            Storage.updateCard(actualEditing.id, { siblingId: null });
          } else if (reverse && actualEditing.siblingId) {
            Storage.updateCard(actualEditing.siblingId, { front: back, back: front, tags, deckId: targetDeckId });
          }
        } else {
          const primary = Storage.addCard({ deckId: targetDeckId, type: fType, front, back, tags });
          if (reverse) {
            const sib = Storage.addCard({ deckId: targetDeckId, type: 'reversed', front: back, back: front, tags, siblingId: primary.id });
            Storage.updateCard(primary.id, { siblingId: sib.id });
          }
        }
      }
      toast(actualEditing ? 'Card updated' : 'Card added', { type: 'success' });
      closeModal();
      refresh();
      if (!$('#viewRoot').hidden && state.currentDeckId) {
        const v = $('#viewRoot .view');
        if (v) renderDeckDetail(v, state.currentDeckId);
      }
    });

    if (actualEditing) {
      sheet.querySelector('[data-act="delete"]').addEventListener('click', () => {
        closeModal();
        softDeleteCard(actualEditing);
      });
    }

    setTimeout(() => {
      if (fType === 'cloze') clozeInput.focus();
      else frontInput.focus();
    }, 200);
  }

  /* ---------------------------------------------------------- */
  /* Modals & Sheets                                             */
  /* ---------------------------------------------------------- */
  function confirmDeleteDeck(deck) {
    const cards = Storage.cardsOf(deck.id);
    const sheet = document.createElement('div');
    sheet.className = 'modal-sheet';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">Delete deck?</h3>
      <p class="sheet-body">"<strong>${escapeHTML(deck.name)}</strong>" and its <strong>${cards.length}</strong> card${cards.length === 1 ? '' : 's'} will be deleted permanently.</p>
      <div class="sheet-actions">
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
        <button class="btn btn-danger" data-act="confirm">Delete</button>
      </div>
    `;
    openModal(sheet);
    sheet.querySelector('[data-act="cancel"]').addEventListener('click', closeModal);
    sheet.querySelector('[data-act="confirm"]').addEventListener('click', () => {
      Storage.removeDeck(deck.id);
      closeModal();
      if (!$('#viewRoot').hidden) closeView();
      refresh();
      toast('Deck deleted', { type: 'success', icon: 'fa-trash-can' });
    });
  }

  function confirmResetDeck(deck) {
    const sheet = document.createElement('div');
    sheet.className = 'modal-sheet';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">Reset progress?</h3>
      <p class="sheet-body">All cards in "<strong>${escapeHTML(deck.name)}</strong>" will be marked as due today.</p>
      <div class="sheet-actions">
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
        <button class="btn btn-danger" data-act="confirm">Reset</button>
      </div>
    `;
    openModal(sheet);
    sheet.querySelector('[data-act="cancel"]').addEventListener('click', closeModal);
    sheet.querySelector('[data-act="confirm"]').addEventListener('click', () => {
      Storage.resetDeckProgress(deck.id);
      closeModal();
      refresh();
      toast('Progress reset', { type: 'success', icon: 'fa-rotate-left' });
    });
  }

  function confirmResetAll() {
    const sheet = document.createElement('div');
    sheet.className = 'modal-sheet';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">Reset all data?</h3>
      <p class="sheet-body">This permanently deletes every deck, card, and review.</p>
      <label class="confirm-input-label">
        Type <code>DELETE</code> to confirm
        <input type="text" id="confirmResetInput" autocomplete="off" autocapitalize="characters" spellcheck="false">
      </label>
      <div class="sheet-actions">
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
        <button class="btn btn-danger" data-act="confirm" disabled>Reset</button>
      </div>
    `;
    openModal(sheet);
    const input = sheet.querySelector('#confirmResetInput');
    const confirmBtn = sheet.querySelector('[data-act="confirm"]');
    input.addEventListener('input', () => { confirmBtn.disabled = input.value.trim().toUpperCase() !== 'DELETE'; });
    sheet.querySelector('[data-act="cancel"]').addEventListener('click', closeModal);
    confirmBtn.addEventListener('click', () => {
      Storage.reset();
      closeModal();
      refresh();
      toast('All data cleared', { type: 'success', icon: 'fa-broom' });
    });
  }

  function openIntervalsSheet(deckId) {
    const deck = Storage.getDeck(deckId);
    if (!deck) return;

    const sheet = document.createElement('div');
    sheet.className = 'modal-sheet';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="intervals-head">
        <span class="intervals-dot" style="background:${deck.color}"></span>
        <h3 class="intervals-title">${escapeHTML(deck.name)}</h3>
      </div>
      <p class="sheet-body" style="padding: 0 20px 20px;">Days until a card resurfaces after each rating.</p>
      <div style="padding: 0 20px 8px;">
        <div class="interval-grid">
          ${RATING_LABELS.map((label, i) => `
            <div class="interval-cell">
              <label>${label}</label>
              <input type="number" min="0" step="0.01" value="${deck.intervals[i]}" data-idx="${i}" inputmode="decimal">
            </div>
          `).join('')}
        </div>
      </div>
      <div class="sheet-actions">
        <button class="btn btn-primary" data-act="done">Done</button>
      </div>
    `;
    openModal(sheet);

    sheet.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const idx = Number(inp.dataset.idx);
        const v = Math.max(0, parseFloat(inp.value) || 0.01);
        const intervals = [...deck.intervals];
        intervals[idx] = v;
        Storage.updateDeck(deck.id, { intervals });
        state.data = Storage.getData();
        inp.value = v;
      });
    });
    sheet.querySelector('[data-act="done"]').addEventListener('click', closeModal);
  }

  function openStudyByTagSheet(deckId) {
    const cards = Storage.cardsOf(deckId);
    const tags = new Set();
    cards.forEach(c => (c.tags || []).forEach(t => tags.add(t)));
    const sorted = Array.from(tags).sort();
    
    if (!sorted.length) { toast('No tags in this deck', { type: 'info', icon: 'fa-circle-info' }); return; }

    const sheet = document.createElement('div');
    sheet.className = 'modal-sheet';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">Study by Tag</h3>
      <p class="sheet-body">Pick a tag to study only those cards.</p>
      <div style="padding: 0 20px 16px; display: flex; flex-direction: column; gap: 8px;">
        ${sorted.map(t => `<button class="btn btn-ghost" data-tag="${escapeHTML(t)}">#${escapeHTML(t)}</button>`).join('')}
      </div>
      <div class="sheet-actions">
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
      </div>
    `;
    openModal(sheet);
    
    sheet.querySelector('[data-act="cancel"]').addEventListener('click', closeModal);
    sheet.querySelectorAll('[data-tag]').forEach(btn => {
      btn.addEventListener('click', () => {
        closeModal();
        startStudy({ deckId, mode: 'tag', tag: btn.dataset.tag });
      });
    });
  }

  /* ---------------------------------------------------------- */
  /* Tools sheet (Now with Google Drive)                         */
  /* ---------------------------------------------------------- */
  function openToolsSheet() {
    const ro = state.readOnly;
    const sheet = document.createElement('div');
    sheet.className = 'modal-sheet';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">Tools</h3>
      <div class="tools-grid">
        <button class="tool-tile" data-act="backup" ${ro ? 'disabled' : ''}><i class="fa-solid fa-cloud-arrow-up"></i><span>Backup</span></button>
        <button class="tool-tile" data-act="restore" ${ro ? 'disabled' : ''}><i class="fa-solid fa-cloud-arrow-down"></i><span>Restore</span></button>
        <button class="tool-tile" data-act="import-csv" ${ro ? 'disabled' : ''}><i class="fa-solid fa-file-import"></i><span>Import CSV</span></button>
        <button class="tool-tile" data-act="export-csv" ${ro ? 'disabled' : ''}><i class="fa-solid fa-file-export"></i><span>Export CSV</span></button>
        <button class="tool-tile" data-act="print"><i class="fa-solid fa-chart-line"></i><span>Print</span></button>
        <button class="tool-tile danger" data-act="clear-data" ${ro ? 'disabled' : ''}><i class="fa-solid fa-trash-can"></i><span>Clear Data</span></button>
      </div>
      
      ${!ro ? `
      <div style="padding: 16px 20px; border-top: 1px solid var(--line);">
        <div class="settings-section-title" style="padding-left:0; margin-bottom:12px;">Google Drive Backup</div>
        <div class="drive-block" style="padding:0;">
          <label class="drive-field">
            <span class="drive-field-label">OAuth Client ID</span>
            <input type="text" id="driveClientId" placeholder="xxxxxxxx.apps.googleusercontent.com" autocomplete="off" spellcheck="false" autocapitalize="off">
          </label>
          <div class="drive-actions">
            <button class="drive-btn" id="driveConnectBtn"><i class="fa-solid fa-plug"></i><span>Connect</span></button>
            <button class="drive-btn primary" id="drivePushBtn"><i class="fa-solid fa-cloud-arrow-up"></i><span>Push</span></button>
            <button class="drive-btn" id="drivePullBtn"><i class="fa-solid fa-cloud-arrow-down"></i><span>Pull</span></button>
          </div>
          <div class="drive-status" id="driveStatus">Not connected</div>
        </div>
      </div>
      ` : ''}

      <div class="sheet-actions">
        <button class="btn btn-ghost" data-act="cancel">Close</button>
      </div>
    `;
    openModal(sheet);

    sheet.querySelector('[data-act="cancel"]').addEventListener('click', closeModal);
    sheet.querySelectorAll('.tool-tile').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const act = btn.dataset.act;
        closeModal();
        setTimeout(() => handleMenuAction(act), 100);
      });
    });

    const driveInput = sheet.querySelector('#driveClientId');
    if (driveInput) {
      driveInput.value = getStoredClientId();
      driveInput.addEventListener('blur', () => { setStoredClientId(driveInput.value); updateDriveStatus(); });
      driveInput.addEventListener('change', () => { setStoredClientId(driveInput.value); updateDriveStatus(); });
      sheet.querySelector('#driveConnectBtn').addEventListener('click', driveConnect);
      sheet.querySelector('#drivePushBtn').addEventListener('click', drivePush);
      sheet.querySelector('#drivePullBtn').addEventListener('click', drivePull);
      updateDriveStatus();
    }
  }

  /* ---------------------------------------------------------- */
  /* Backup / Restore / CSV                                      */
  /* ---------------------------------------------------------- */
  function backupToFile() {
    const payload = {
      app: 'cjaycards',
      schema: 1,
      exportedAt: new Date().toISOString(),
      data: Storage.getData()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cjaycards-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup saved', { type: 'success', icon: 'fa-cloud-arrow-up' });
  }

  function restoreFromFile() {
    pickFile('.json,application/json', async (file) => {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const incoming = parsed.data || parsed;
        if (!incoming || !Array.isArray(incoming.decks)) throw new Error('Invalid backup');
        showRestoreChoice(incoming);
      } catch (err) {
        toast(`Restore failed: ${err.message}`, { type: 'error', icon: 'fa-triangle-exclamation' });
      }
    });
  }

  function showRestoreChoice(incoming) {
    const sheet = document.createElement('div');
    sheet.className = 'modal-sheet';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">Restore backup</h3>
      <p class="sheet-body">Backup contains <strong>${incoming.decks.length}</strong> deck${incoming.decks.length === 1 ? '' : 's'} and <strong>${(incoming.cards || []).length}</strong> card${(incoming.cards || []).length === 1 ? '' : 's'}.</p>
      <div class="sheet-actions" style="flex-direction:column;">
        <button class="btn btn-primary" data-act="replace">Replace everything</button>
        <button class="btn btn-ghost" data-act="merge">Merge with current</button>
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
      </div>
    `;
    openModal(sheet);
    sheet.querySelector('[data-act="cancel"]').addEventListener('click', closeModal);
    sheet.querySelector('[data-act="replace"]').addEventListener('click', () => {
      Storage.setData(incoming);
      closeModal();
      refresh();
      toast('Backup restored', { type: 'success', icon: 'fa-cloud-arrow-down' });
    });
    sheet.querySelector('[data-act="merge"]').addEventListener('click', () => {
      const current = Storage.getData();
      const deckIds = new Set(current.decks.map((d) => d.id));
      const cardIds = new Set(current.cards.map((c) => c.id));
      let addedDecks = 0, addedCards = 0;
      (incoming.decks || []).forEach((d) => { if (!deckIds.has(d.id)) { current.decks.push(d); addedDecks++; } });
      (incoming.cards || []).forEach((c) => { if (!cardIds.has(c.id)) { current.cards.push(c); addedCards++; } });
      Storage.setData(current);
      closeModal();
      refresh();
      toast(`Merged: ${addedDecks} decks, ${addedCards} cards`, { type: 'success', icon: 'fa-cloud-arrow-down' });
    });
  }

  function exportCSV() {
    const rows = [['Deck', 'Type', 'Front/Cloze', 'Back', 'Tags', 'DueDate', 'EasyStreak', 'FailCount', 'Mastered']];
    state.data.cards.forEach((c) => {
      const deck = Storage.getDeck(c.deckId);
      rows.push([
        deck?.name || '',
        c.type || 'basic',
        c.type === 'cloze' ? c.clozeText : c.front,
        c.back,
        (c.tags || []).join(';'),
        c.dueDate || '',
        c.easyStreak || 0,
        c.failCount || 0,
        Storage.isMastered(c) ? 'yes' : 'no'
      ]);
    });
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cjaycards-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV exported', { type: 'success', icon: 'fa-file-export' });
  }

  function importCSVFromFile() {
    const sheet = document.createElement('div');
    sheet.className = 'modal-sheet';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">Import CSV</h3>
      <p class="sheet-body">Your CSV should have columns for <strong>Front</strong>, <strong>Back</strong>, <strong>Tags</strong> (semicolon separated), and optionally <strong>Deck</strong>.</p>
      <div style="padding: 0 20px 16px; text-align: center;">
        <a href="data:text/csv;charset=utf-8,Front,Back,Tags,Deck%0AWhat%20is%20the%20capital%20of%20France%3F,Paris,geography%3Beurope,General" download="cjaycards_template.csv" class="csv-template-link"><i class="fa-solid fa-download"></i> Download Template CSV</a>
      </div>
      <div class="sheet-actions" style="flex-direction:column;">
        <button class="btn btn-primary" data-act="pick">Select File</button>
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
      </div>
    `;
    openModal(sheet);
    
    sheet.querySelector('[data-act="cancel"]').addEventListener('click', closeModal);
    sheet.querySelector('[data-act="pick"]').addEventListener('click', () => {
      closeModal();
      pickFile('.csv,text/csv', async (file) => {
        try {
          const text = await file.text();
          const rows = parseCSV(text);
          if (rows.length < 2) throw new Error('Empty CSV');

          const header = rows[0].map((h) => h.trim().toLowerCase());
          const idx = (n) => header.indexOf(n);
          const iDeck = idx('deck');
          const iType = idx('type');
          const iFront = idx('front') !== -1 ? idx('front') : idx('front/cloze');
          const iBack = idx('back');
          const iTags = idx('tags');
          if (iFront === -1 || iBack === -1) throw new Error('Missing front/back columns');

          const current = Storage.getData();
          const deckMap = new Map();
          current.decks.forEach((d) => deckMap.set(d.name.toLowerCase(), d.id));

          let added = 0;
          for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const type = iType !== -1 ? (r[iType] || 'basic').toLowerCase() : 'basic';
            const frontOrCloze = (r[iFront] || '').trim();
            const back = (r[iBack] || '').trim();
            if (!frontOrCloze) continue;

            const deckName = iDeck !== -1 ? (r[iDeck] || '').trim() : 'Imported';
            let deckId = deckMap.get(deckName.toLowerCase());
            if (!deckId) {
              const deck = Storage.addDeck({ name: deckName || 'Imported', color: null });
              deckId = deck.id;
              deckMap.set(deckName.toLowerCase(), deckId);
              current.decks.push(deck);
            }

            const tags = iTags !== -1 && r[iTags] ? r[iTags].split(';').map((t) => t.trim()).filter(Boolean) : [];
            
            if (type === 'cloze') {
              Storage.addCard({ deckId, type: 'cloze', clozeText: frontOrCloze, tags });
            } else {
              Storage.addCard({ deckId, type, front: frontOrCloze, back, tags });
            }
            added++;
          }
          refresh();
          toast(`Imported ${added} card${added === 1 ? '' : 's'}`, { type: 'success', icon: 'fa-file-import' });
        } catch (err) {
          toast(`Import failed: ${err.message}`, { type: 'error', icon: 'fa-triangle-exclamation' });
        }
      });
    });
  }

  function pickFile(accept, onPick) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) onPick(file);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  }

  function parseCSV(text) {
    const rows = [];
    let row = [], cur = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { row.push(cur); cur = ''; }
        else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
        else if (c !== '\r') cur += c;
      }
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.length));
  }

  /* ---------------------------------------------------------- */
  /* Drive sync                                                  */
  /* ---------------------------------------------------------- */
  const DRIVE = {
    clientIdKey: 'cjay_gdrive_client_id',
    lastSyncKey: 'cjaycards_last_sync',
    folderName: 'CjayCards',
    fileName: 'cjaycards.json',
    scope: 'https://www.googleapis.com/auth/drive.file',
    token: null,
    tokenClient: null,
    gapiReady: false,
    folderId: null,
    initPromise: null
  };

  function getStoredClientId() { return localStorage.getItem(DRIVE.clientIdKey) || ''; }
  function setStoredClientId(id) {
    if (id) localStorage.setItem(DRIVE.clientIdKey, id.trim());
    else localStorage.removeItem(DRIVE.clientIdKey);
    DRIVE.tokenClient = null;
    DRIVE.gapiReady = false;
    DRIVE.folderId = null;
    DRIVE.token = null;
    DRIVE.initPromise = null;
  }
  function getLastSync() { return localStorage.getItem(DRIVE.lastSyncKey) || ''; }
  function setLastSync(iso) {
    localStorage.setItem(DRIVE.lastSyncKey, iso);
    Storage.updateSettings({ lastSync: iso });
  }

  function waitForGlobals(timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (typeof gapi !== 'undefined' && typeof google !== 'undefined' && google.accounts?.oauth2) resolve();
        else if (Date.now() - start > timeoutMs) reject(new Error('Google libraries failed to load'));
        else setTimeout(check, 150);
      };
      check();
    });
  }

  function initDrive() {
    if (DRIVE.initPromise) return DRIVE.initPromise;
    DRIVE.initPromise = (async () => {
      const clientId = getStoredClientId();
      if (!clientId) throw new Error('No client ID');
      await waitForGlobals();
      if (!DRIVE.gapiReady) {
        await new Promise((res, rej) => gapi.load('client', { callback: res, onerror: () => rej(new Error('gapi.load failed')) }));
        await gapi.client.init({ discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'] });
        DRIVE.gapiReady = true;
      }
      if (!DRIVE.tokenClient) {
        DRIVE.tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: DRIVE.scope,
          callback: () => {}
        });
      }
      return true;
    })();
    DRIVE.initPromise.catch(() => { DRIVE.initPromise = null; });
    return DRIVE.initPromise;
  }

  function ensureAccessToken({ forcePrompt = false } = {}) {
    return new Promise((resolve, reject) => {
      if (DRIVE.token && !forcePrompt) return resolve(DRIVE.token);
      if (!DRIVE.tokenClient) return reject(new Error('Drive not initialised'));
      DRIVE.tokenClient.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        DRIVE.token = resp.access_token;
        gapi.client.setToken({ access_token: resp.access_token });
        resolve(resp.access_token);
      };
      DRIVE.tokenClient.requestAccessToken({ prompt: forcePrompt ? 'consent' : '' });
    });
  }

  async function getOrCreateFolder() {
    if (DRIVE.folderId) return DRIVE.folderId;
    const q = `mimeType='application/vnd.google-apps.folder' and name='${DRIVE.folderName}' and trashed=false`;
    const res = await gapi.client.drive.files.list({ q, fields: 'files(id,name)', spaces: 'drive' });
    const files = res.result.files || [];
    if (files.length) { DRIVE.folderId = files[0].id; return DRIVE.folderId; }
    const create = await gapi.client.drive.files.create({
      resource: { name: DRIVE.folderName, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id'
    });
    DRIVE.folderId = create.result.id;
    return DRIVE.folderId;
  }

  async function findDriveFile(folderId) {
    const q = `name='${DRIVE.fileName}' and '${folderId}' in parents and trashed=false`;
    const res = await gapi.client.drive.files.list({ q, fields: 'files(id,name,modifiedTime)', spaces: 'drive' });
    return (res.result.files || [])[0] || null;
  }

  async function driveConnect() {
    try {
      await initDrive();
      await ensureAccessToken({ forcePrompt: true });
      toast('Connected to Drive', { type: 'success', icon: 'fa-plug' });
      updateDriveStatus();
    } catch (err) {
      toast(`Connect failed: ${err.message}`, { type: 'error', icon: 'fa-triangle-exclamation' });
    }
  }

  async function drivePush() {
    try {
      await initDrive();
      await ensureAccessToken();
      const folderId = await getOrCreateFolder();
      const file = await findDriveFile(folderId);
      const payload = JSON.stringify({
        app: 'cjaycards', schema: 1, exportedAt: new Date().toISOString(), data: Storage.getData()
      }, null, 2);

      const boundary = '-------cjaycards' + Date.now();
      const delimiter = '\r\n--' + boundary + '\r\n';
      const closeDelim = '\r\n--' + boundary + '--';
      const metadata = file ? { name: DRIVE.fileName } : { name: DRIVE.fileName, parents: [folderId] };
      const body = delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata)
        + delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + payload + closeDelim;

      await gapi.client.request({
        path: file ? `/upload/drive/v3/files/${file.id}` : '/upload/drive/v3/files',
        method: file ? 'PATCH' : 'POST',
        params: { uploadType: 'multipart' },
        headers: { 'Content-Type': `multipart/related; boundary="${boundary}"` },
        body
      });

      setLastSync(new Date().toISOString());
      updateDriveStatus();
      toast('Pushed to Drive', { type: 'success', icon: 'fa-cloud-arrow-up' });
    } catch (err) {
      toast(`Push failed: ${err.message}`, { type: 'error', icon: 'fa-triangle-exclamation' });
    }
  }

  async function drivePull() {
    try {
      await initDrive();
      await ensureAccessToken();
      const folderId = await getOrCreateFolder();
      const file = await findDriveFile(folderId);
      if (!file) { toast('No Drive backup found', { type: 'info', icon: 'fa-circle-info' }); return; }

      const res = await gapi.client.drive.files.get({ fileId: file.id, alt: 'media' });
      const raw = typeof res.body === 'string' ? res.body : JSON.stringify(res.result);
      const parsed = JSON.parse(raw);
      const incoming = parsed.data || parsed;
      if (!incoming || !Array.isArray(incoming.decks)) throw new Error('Invalid backup on Drive');
      showDrivePullChoice(incoming, file.modifiedTime);
    } catch (err) {
      toast(`Pull failed: ${err.message}`, { type: 'error', icon: 'fa-triangle-exclamation' });
    }
  }

  function showDrivePullChoice(incoming, modifiedTime) {
    const modifiedLabel = modifiedTime ? new Date(modifiedTime).toLocaleString() : 'unknown';
    const sheet = document.createElement('div');
    sheet.className = 'modal-sheet';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">Pull from Drive</h3>
      <p class="sheet-body">Cloud backup: <strong>${incoming.decks.length}</strong> decks · <strong>${(incoming.cards || []).length}</strong> cards (${escapeHTML(modifiedLabel)}).</p>
      <div class="sheet-actions" style="flex-direction:column;">
        <button class="btn btn-primary" data-act="replace">Replace everything</button>
        <button class="btn btn-ghost" data-act="merge">Merge with current</button>
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
      </div>
    `;
    openModal(sheet);
    sheet.querySelector('[data-act="cancel"]').addEventListener('click', closeModal);
    sheet.querySelector('[data-act="replace"]').addEventListener('click', () => {
      Storage.setData(incoming);
      setLastSync(new Date().toISOString());
      closeModal(); refresh(); updateDriveStatus();
      toast('Pulled from Drive', { type: 'success', icon: 'fa-cloud-arrow-down' });
    });
    sheet.querySelector('[data-act="merge"]').addEventListener('click', () => {
      const current = Storage.getData();
      const deckIds = new Set(current.decks.map((d) => d.id));
      const cardIds = new Set(current.cards.map((c) => c.id));
      let addedDecks = 0, addedCards = 0;
      (incoming.decks || []).forEach((d) => { if (!deckIds.has(d.id)) { current.decks.push(d); addedDecks++; } });
      (incoming.cards || []).forEach((c) => { if (!cardIds.has(c.id)) { current.cards.push(c); addedCards++; } });
      Storage.setData(current);
      setLastSync(new Date().toISOString());
      closeModal(); refresh(); updateDriveStatus();
      toast(`Merged: ${addedDecks} decks, ${addedCards} cards`, { type: 'success', icon: 'fa-cloud-arrow-down' });
    });
  }

  function updateDriveStatus() {
    const el = document.getElementById('driveStatus');
    if (!el) return;
    const clientId = getStoredClientId();
    const lastSync = getLastSync();
    if (!clientId) el.textContent = 'Paste your Client ID to enable sync';
    else if (!lastSync) el.textContent = 'Ready to sync';
    else el.textContent = `Last synced ${relativeTime(lastSync)}`;
  }

  /* ---------------------------------------------------------- */
  /* Offline & Install                                           */
  /* ---------------------------------------------------------- */
  const offlineBanner = $('#offlineBanner');
  function updateOnlineStatus() { offlineBanner.classList.toggle('show', !navigator.onLine); }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  const installBanner = $('#installBanner');
  const installAccept = $('#installAccept');
  const installDismiss = $('#installDismiss');
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (localStorage.getItem(LS.installDismissed) !== '1') installBanner.hidden = false;
  });

  installAccept.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBanner.hidden = true;
    toast(outcome === 'accepted' ? 'Installing…' : 'Install dismissed', {
      type: outcome === 'accepted' ? 'success' : 'info', icon: 'fa-circle-down'
    });
  });

  installDismiss.addEventListener('click', () => {
    installBanner.hidden = true;
    localStorage.setItem(LS.installDismissed, '1');
  });

  /* ---------------------------------------------------------- */
  /* Service worker                                              */
  /* ---------------------------------------------------------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast(reg);
          });
        });
        setInterval(() => reg.update(), 30 * 60 * 1000);
      }).catch((err) => console.warn('SW registration failed:', err));
    });
  }

  function showUpdateToast(reg) {
    const menuBadge = $('#menuBadge');
    const el = toast('New version available', {
      icon: 'fa-arrows-rotate', type: 'info', persist: true,
      action: {
        label: 'Refresh',
        onClick: () => { reg.waiting?.postMessage({ type: 'SKIP_WAITING' }); setTimeout(() => window.location.reload(), 200); }
      }
    });
    setTimeout(() => { if (el && !el._dismissed) { dismissToast(el); menuBadge.hidden = false; } }, 30000);
    menuBadge.addEventListener('click', () => { menuBadge.hidden = true; showUpdateToast(reg); }, { once: true });
  }

  let refreshing = false;
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  /* ---------------------------------------------------------- */
  /* Init                                                        */
  /* ---------------------------------------------------------- */
  function init() {
    parseUrlFlags();

    if (state.demoMode) {
      state.data = Storage.getDummyData();
      const badge = document.createElement('span');
      badge.className = 'view-badge';
      badge.textContent = 'View Only';
      badge.style.cssText = 'font-size:10px;font-weight:700;color:var(--muted);background:var(--card-2);padding:4px 10px;border-radius:999px;text-transform:uppercase;letter-spacing:.04em;';
      $('.header-right').insertBefore(badge, $('.header-right').firstChild);
    } else {
      state.data = Storage.getData();
    }

    const s = state.data.settings || {};
    applyTheme(s.family || localStorage.getItem(LS.family) || 'slate', s.mode || localStorage.getItem(LS.mode) || 'light');

    refresh();
    updateSyncIcon('synced');
    setTimeout(() => syncToWorker(), 500);
  }

  init();

  window.CjayCards = {
    toast, dismissToast, openModal, closeModal,
    openView, closeView, refresh,
    getState: () => state
  };
})();
