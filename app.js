// ============================================================
// CONFIG
// ============================================================
const STORAGE_KEY = 'cjaycards_data';
const THEME_KEY = 'cjaycards_theme';
const DRIVE_CLIENT_KEY = 'cjaycards_drive_client';
const DRIVE_TOKEN_KEY = 'cjaycards_drive_token';
const LEECH_THRESHOLD = 5;

const DECK_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#eab308', '#8b5cf6', '#f97316', '#ec4899', '#14b8a6'];

const ICON_MOON = '<svg class="icon-svg" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const ICON_SUN = '<svg class="icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path d="M12 1v2"/><path d="M12 21v2"/><path d="M4.22 4.22l1.42 1.42"/><path d="M18.36 18.36l1.42 1.42"/><path d="M1 12h2"/><path d="M21 12h2"/><path d="M4.22 19.78l1.42-1.42"/><path d="M18.36 5.64l1.42-1.42"/></svg>';
const ICON_CHEVRON = '<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>';

// ============================================================
// STATE
// ============================================================

let state = loadState();
let currentView = 'home';
let currentDeckId = null;
let cardFilter = 'all';
let studySession = null;
let editingCardId = null;
let editingDeckId = null;
let pendingDelete = null;

// ============================================================
// PERSISTENCE
// ============================================================
function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (!parsed.decks) parsed.decks = {};
            if (!parsed.cards) parsed.cards = {};
            if (!parsed.deletedIds) parsed.deletedIds = { decks: [], cards: [] };
            if (!parsed.studyStreak) parsed.studyStreak = { lastDate: null, count: 0 };
            return parsed;
        }
    } catch (e) {}
    return getDefaultState();
}

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
}

// ============================================================
// HELPERS
// ============================================================
function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function nowISO() {
    return new Date().toISOString();
}

function todayStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function tomorrowStart() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
}

function isDue(card) {
    if (!card.dueDate) return true;
    return new Date(card.dueDate) <= new Date();
}

function isBuried(card) {
    if (!card.buried) return false;
    if (!card.buriedUntil) return true;
    return new Date(card.buriedUntil) > new Date();
}

function isLeech(card) {
    return (card.failCount || 0) >= LEECH_THRESHOLD;
}

function formatInterval(days) {
    if (days < 1 / 24) return '<1h';
    if (days < 1) return Math.round(days * 24) + 'h';
    if (days < 30) return Math.round(days) + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return Math.round(days / 365) + 'y';
}

function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 172800000) return 'yesterday';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function getDeckColor(deckId) {
    const d = state.decks[deckId];
    return d?.color || DECK_COLORS[0];
}

// ============================================================
// CLOZE PARSING
// ============================================================
function parseCloze(text) {
    // Supports {{c1::answer}} or {{answer}}
    const regex = /\{\{(?:c\d+::)?([^}]+)\}\}/g;
    const matches = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
        matches.push({ full: m[0], answer: m[1], index: m.index });
    }
    return matches;
}

function renderClozeHidden(text) {
    const regex = /\{\{(?:c\d+::)?([^}]+)\}\}/g;
    return text.replace(regex, (_, answer) => {
        return `<span class="study-cloze-blank">${'_'.repeat(Math.min(answer.length, 12))}</span>`;
    });
}

function renderClozeRevealed(text) {
    const regex = /\{\{(?:c\d+::)?([^}]+)\}\}/g;
    return text.replace(regex, (_, answer) => {
        return `<span class="study-cloze-answer">${escapeHtml(answer)}</span>`;
    });
}

function clozeHasMarkers(text) {
    return /\{\{(?:c\d+::)?[^}]+\}\}/.test(text || '');
}

// ============================================================
// DATA CRUD — DECKS
// ============================================================
function createDeck(name, color) {
    const id = genId();
    state.decks[id] = {
        id,
        name: name.trim(),
        color: color || DECK_COLORS[0],
        intervals: [0.0417, 1, 3, 7],
        createdAt: nowISO(),
        updatedAt: nowISO()
    };
    saveState();
    return id;
}

function updateDeck(deckId, updates) {
    if (!state.decks[deckId]) return;
    Object.assign(state.decks[deckId], updates, { updatedAt: nowISO() });
    saveState();
}

function deleteDeck(deckId) {
    if (!state.decks[deckId]) return;

    const affectedCards = Object.values(state.cards).filter(c => c.deckId === deckId);
    affectedCards.forEach(c => {
        if (!state.deletedIds.cards.includes(c.id)) state.deletedIds.cards.push(c.id);
    });
    Object.keys(state.cards).forEach(id => {
        if (state.cards[id].deckId === deckId) delete state.cards[id];
    });

    delete state.decks[deckId];
    if (!state.deletedIds.decks.includes(deckId)) state.deletedIds.decks.push(deckId);
    saveState();
}

// ============================================================
// DATA CRUD — CARDS
// ============================================================
function createCard(deckId, data) {
    const id = genId();
    const now = nowISO();
    const card = {
        id,
        deckId,
        type: data.type || 'basic',
        front: data.front || '',
        back: data.back || '',
        clozeText: data.clozeText || '',
        tags: data.tags || [],
        dueDate: data.dueDate || now,
        step: 0,
        ease: 2.5,
        failCount: 0,
        history: [],
        favorite: false,
        buried: false,
        buriedUntil: null,
        siblingId: data.siblingId || null,
        createdAt: now,
        updatedAt: now
    };
    state.cards[id] = card;
    saveState();
    return id;
}

function updateCard(cardId, updates) {
    if (!state.cards[cardId]) return;
    Object.assign(state.cards[cardId], updates, { updatedAt: nowISO() });
    saveState();
}

function deleteCardWithSibling(cardId) {
    const card = state.cards[cardId];
    if (!card) return;

    if (card.siblingId && state.cards[card.siblingId]) {
        const sibling = state.cards[card.siblingId];
        sibling.siblingId = null;
    }

    if (!state.deletedIds.cards.includes(cardId)) {
        state.deletedIds.cards.push(cardId);
    }
    delete state.cards[cardId];
    saveState();
}

function getCardsInDeck(deckId) {
    return Object.values(state.cards).filter(c => c.deckId === deckId);
}

function getDueCards(deckId) {
    return getCardsInDeck(deckId).filter(c => isDue(c) && !isBuried(c));
}

// ============================================================
// THEME
// ============================================================
function getStoredTheme() {
    return localStorage.getItem(THEME_KEY) || 'dark';
}

function applyTheme() {
    const theme = getStoredTheme();
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('themeBtn');
    if (btn) btn.innerHTML = theme === 'dark' ? ICON_MOON : ICON_SUN;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0a1628' : '#f0f4fa');
}

function toggleTheme() {
    const next = getStoredTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme();
}

// ============================================================
// TOASTS
// ============================================================
let toastTimeout;
function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.classList.remove('show'), 2200);
}

// ============================================================
// MODAL
// ============================================================
function openModal(html) {
    const overlay = document.getElementById('modalOverlay');
    const content = document.getElementById('modalContent');
    content.innerHTML = html;
    overlay.classList.add('active');
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
}

// ============================================================
// NAVIGATION
// ============================================================
function showView(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById('view-' + view);
    if (target) target.classList.add('active');
    currentView = view;

    if (view === 'home') renderHome();
    if (view === 'deck') renderDeck();
    if (view === 'study') renderStudy();
    if (view === 'settings') renderSettings();
}

function closeAllPopups(except) {
    document.querySelectorAll('.popup-menu').forEach(m => {
        if (m !== except) m.classList.remove('open');
    });
}

// ============================================================
// RENDER — HOME
// ============================================================
function renderHome() {
    const deckIds = Object.keys(state.decks);
    const totalDecks = deckIds.length;
    const totalCards = Object.keys(state.cards).length;
    const totalDue = Object.values(state.cards).filter(c => isDue(c) && !isBuried(c) && !c.archived).length;

    document.getElementById('statDecks').textContent = totalDecks;
    document.getElementById('statDue').textContent = totalDue;
    document.getElementById('statCards').textContent = totalCards;

    const list = document.getElementById('deckList');
    if (deckIds.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24"><rect x="4" y="5" width="14" height="16" rx="2"/><path d="M8 5V3a2 2 0 012-2h8a2 2 0 012 2v14a2 2 0 01-2 2h-2"/></svg>
                <h3>No decks yet</h3>
                <p>Tap "New deck" below to get started.</p>
            </div>
        `;
        return;
    }

    const sorted = deckIds.map(id => state.decks[id]).sort((a, b) => {
        const da = new Date(a.updatedAt || a.createdAt);
        const db = new Date(b.updatedAt || b.createdAt);
        return db - da;
    });

    list.innerHTML = sorted.map(deck => {
        const cards = getCardsInDeck(deck.id);
        const due = cards.filter(c => isDue(c) && !isBuried(c)).length;
        return `
            <div class="deck-row" data-deck="${deck.id}" style="--deck-color: ${deck.color}">
                <div class="deck-row-info">
                    <div class="deck-row-name">${escapeHtml(deck.name)}</div>
                    <div class="deck-row-meta">
                        ${due > 0 ? `<span class="due">${due} due</span>` : '<span>No cards due</span>'}
                        <span>·</span>
                        <span>${cards.length} ${cards.length === 1 ? 'card' : 'cards'}</span>
                    </div>
                </div>
                <div class="deck-row-arrow">${ICON_CHEVRON}</div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('.deck-row').forEach(row => {
        row.addEventListener('click', () => {
            currentDeckId = row.dataset.deck;
            cardFilter = 'all';
            showView('deck');
        });
    });
}

// ============================================================
// RENDER — DECK VIEW
// ============================================================
function renderDeck() {
    const deck = state.decks[currentDeckId];
    if (!deck) { showView('home'); return; }

    document.getElementById('deckTitle').textContent = deck.name;
    const allCards = getCardsInDeck(currentDeckId);
    const due = allCards.filter(c => isDue(c) && !isBuried(c)).length;
    document.getElementById('deckMeta').textContent = `${allCards.length} ${allCards.length === 1 ? 'card' : 'cards'} · ${due} due`;

    document.querySelectorAll('#cardFilters .filter-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.filter === cardFilter);
    });

    const filtered = getFilteredCards();
    renderCardList(filtered);
}

function getFilteredCards() {
    const all = getCardsInDeck(currentDeckId).sort((a, b) => {
        const da = new Date(a.updatedAt || a.createdAt);
        const db = new Date(b.updatedAt || b.createdAt);
        return db - da;
    });
    if (cardFilter === 'due') return all.filter(c => isDue(c) && !isBuried(c));
    if (cardFilter === 'leeches') return all.filter(isLeech);
    if (cardFilter === 'buried') return all.filter(isBuried);
    return all;
}

function renderCardList(cards) {
    const list = document.getElementById('cardList');
    if (cards.length === 0) {
        const msg = cardFilter === 'all' ? 'No cards in this deck yet.' :
                    cardFilter === 'due' ? 'No cards due.' :
                    cardFilter === 'leeches' ? 'No leeches yet.' :
                    'No buried cards.';
        list.innerHTML = `<div class="empty-list">${msg}</div>`;
        return;
    }

    list.innerHTML = cards.map(card => {
        const badges = [];
        if (card.type === 'reversed') badges.push('<span class="badge badge-reversed">Reversed</span>');
        if (card.type === 'typing') badges.push('<span class="badge badge-typing">Typing</span>');
        if (card.type === 'cloze') badges.push('<span class="badge badge-cloze">Cloze</span>');
        if (isLeech(card)) badges.push('<span class="badge badge-leech">Leech</span>');
        if (isBuried(card)) badges.push('<span class="badge badge-buried">Buried</span>');

        const display = card.type === 'cloze'
            ? card.clozeText.replace(/\{\{(?:c\d+::)?([^}]+)\}\}/g, '[$1]')
            : card.front;
        const tags = (card.tags || []).slice(0, 3);
        const dateStr = isBuried(card) ? `Until ${formatDate(card.buriedUntil)}` : formatDate(card.dueDate);

        return `
            <div class="card-item" data-card="${card.id}">
                <div class="card-item-top">
                    <div class="card-item-text">${escapeHtml(display || 'Empty card')}</div>
                    <div class="card-item-badges">${badges.join('')}</div>
                </div>
                <div class="card-item-bottom">
                    <div class="card-item-tags">
                        ${tags.map(t => `<span class="card-item-tag">#${escapeHtml(t)}</span>`).join('')}
                    </div>
                    <div class="card-item-date">${dateStr}</div>
                </div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('.card-item').forEach(item => {
        item.addEventListener('click', () => openCardEditor(item.dataset.card));
    });
}

// ============================================================
// CARD EDITOR
// ============================================================
function openCardEditor(cardId) {
    let card = cardId ? state.cards[cardId] : null;
    // If this is the reversed twin, edit the primary instead
    if (card && card.type === 'reversed' && card.siblingId && state.cards[card.siblingId]) {
        card = state.cards[card.siblingId];
        cardId = card.id;
    }
    editingCardId = cardId || null;

    const isEditing = !!card;
    const type = card?.type || 'basic';
    const front = card?.front || '';
    const back = card?.back || '';
    const clozeText = card?.clozeText || '';
    const tags = (card?.tags || []).join(', ');
    const hasSibling = !!(card && card.type === 'basic' && card.siblingId && state.cards[card.siblingId]);

    const html = `
        <h2>${isEditing ? 'Edit card' : 'New card'}</h2>
        <p class="modal-sub">${isEditing ? 'Update this card.' : 'Add a card to this deck.'}</p>

        <label>Type</label>
        <select id="cardTypeSelect">
            <option value="basic" ${type === 'basic' ? 'selected' : ''}>Basic (front → back)</option>
            <option value="typing" ${type === 'typing' ? 'selected' : ''}>Typing (type the answer)</option>
            <option value="cloze" ${type === 'cloze' ? 'selected' : ''}>Cloze (fill in the blank)</option>
        </select>

        <div id="basicFields" ${type === 'cloze' ? 'style="display:none"' : ''}>
            <label>Front</label>
            <textarea id="cardFront" placeholder="Question or prompt">${escapeHtml(front)}</textarea>
            <label>Back</label>
            <textarea id="cardBack" placeholder="Answer">${escapeHtml(back)}</textarea>
            <div class="checkbox-row">
                <input type="checkbox" id="alsoReversed" ${hasSibling ? 'checked' : ''}>
                <span>Also test reversed (back → front)</span>
            </div>
        </div>

        <div id="clozeFields" ${type !== 'cloze' ? 'style="display:none"' : ''}>
            <label>Cloze text</label>
            <textarea id="cardClozeText" placeholder="The capital of France is {{c1::Paris}}.">${escapeHtml(clozeText)}</textarea>
            <p class="field-hint">Wrap hidden parts in <code>{{c1::answer}}</code>. Multiple clozes allowed.</p>
        </div>

        <label>Tags (comma separated)</label>
        <input type="text" id="cardTags" placeholder="work, personal, exam" value="${escapeHtml(tags)}">

        <div class="btn-row">
            ${isEditing ? '<button class="btn btn-outline" id="cardDeleteBtn">Delete</button>' : ''}
            <button class="btn btn-outline" id="cardCancelBtn">Cancel</button>
            <button class="btn btn-primary" id="cardSaveBtn">Save</button>
        </div>
    `;

    openModal(html);

    const typeSelect = document.getElementById('cardTypeSelect');
    const basicFields = document.getElementById('basicFields');
    const clozeFields = document.getElementById('clozeFields');

    typeSelect.addEventListener('change', () => {
        const t = typeSelect.value;
        basicFields.style.display = t === 'cloze' ? 'none' : 'block';
        clozeFields.style.display = t === 'cloze' ? 'block' : 'none';
    });

    document.getElementById('cardCancelBtn').addEventListener('click', closeModal);

    if (isEditing) {
        document.getElementById('cardDeleteBtn').addEventListener('click', () => {
            closeModal();
            deleteCardFlow(cardId);
        });
    }

    document.getElementById('cardSaveBtn').addEventListener('click', () => {
        saveCardEditor(card, typeSelect.value);
    });
}

function saveCardEditor(existingCard, newType) {
    const tagsRaw = document.getElementById('cardTags').value.trim();
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(t => t) : [];

    if (newType === 'cloze') {
        const clozeText = document.getElementById('cardClozeText').value.trim();
        if (!clozeText) { showToast('Cloze text required'); return; }
        if (!clozeHasMarkers(clozeText)) {
            showToast('Add at least one {{c1::answer}} marker');
            return;
        }

        if (existingCard) {
            updateCard(existingCard.id, { type: 'cloze', clozeText, tags });
        } else {
            createCard(currentDeckId, { type: 'cloze', clozeText, tags });
        }
        closeModal();
        renderDeck();
        return;
    }

    const front = document.getElementById('cardFront').value.trim();
    const back = document.getElementById('cardBack').value.trim();
    if (!front || !back) { showToast('Front and back are required'); return; }

    const alsoReversed = document.getElementById('alsoReversed').checked;

    if (existingCard) {
        // Update existing card
        const updates = { type: newType, front, back, tags };

        if (alsoReversed && !existingCard.siblingId) {
            // Create sibling
            const sibId = createCard(currentDeckId, {
                type: 'reversed',
                front: back,
                back: front,
                tags,
                siblingId: existingCard.id
            });
            updates.siblingId = sibId;
        } else if (!alsoReversed && existingCard.siblingId) {
            // Remove sibling
            const sib = state.cards[existingCard.siblingId];
            if (sib) {
                if (!state.deletedIds.cards.includes(sib.id)) state.deletedIds.cards.push(sib.id);
                delete state.cards[sib.id];
            }
            updates.siblingId = null;
        } else if (alsoReversed && existingCard.siblingId) {
            // Sync sibling content
            const sib = state.cards[existingCard.siblingId];
            if (sib) {
                updateCard(sib.id, { front: back, back: front, tags });
            }
        }

        updateCard(existingCard.id, updates);
    } else {
        // Create new card
        const primaryId = createCard(currentDeckId, { type: newType, front, back, tags });
        if (alsoReversed) {
            const sibId = createCard(currentDeckId, {
                type: 'reversed',
                front: back,
                back: front,
                tags,
                siblingId: primaryId
            });
            updateCard(primaryId, { siblingId: sibId });
        }
    }

    closeModal();
    renderDeck();
}

function deleteCardFlow(cardId) {
    const card = state.cards[cardId];
    if (!card) return;

    pendingDelete = { card, id: cardId, timer: null };
    deleteCardWithSibling(cardId);

    const toast = document.getElementById('undoToast');
    document.getElementById('undoText').textContent = 'Card deleted';
    toast.classList.add('show');

    if (pendingDelete.timer) clearTimeout(pendingDelete.timer);
    pendingDelete.timer = setTimeout(() => {
        toast.classList.remove('show');
        pendingDelete = null;
    }, 5000);

    renderDeck();
}

function undoDeleteCard() {
    if (!pendingDelete) return;
    document.getElementById('undoToast').classList.remove('show');
    const { card, id } = pendingDelete;
    state.cards[id] = card;
    // Remove from tombstones
    state.deletedIds.cards = state.deletedIds.cards.filter(x => x !== id);
    // If it had a sibling, restore the link
    if (card.siblingId && state.cards[card.siblingId]) {
        state.cards[card.siblingId].siblingId = id;
    }
    saveState();
    clearTimeout(pendingDelete.timer);
    pendingDelete = null;
    renderDeck();
    showToast('Card restored');
}

// ============================================================
// DECK EDITOR / CREATOR
// ============================================================
function openDeckEditor(deckId) {
    editingDeckId = deckId || null;
    const isEditing = !!deckId;
    const deck = deckId ? state.decks[deckId] : null;

    const name = deck?.name || '';
    const color = deck?.color || DECK_COLORS[0];
    const intervals = deck?.intervals || [0.0417, 1, 3, 7];

    const colorsHtml = DECK_COLORS.map(c => `
        <button class="color-option ${c === color ? 'selected' : ''}" data-color="${c}" style="background: ${c}"></button>
    `).join('');

    const html = `
        <h2>${isEditing ? 'Edit deck' : 'New deck'}</h2>
        <p class="modal-sub">${isEditing ? 'Update deck details and intervals.' : 'Create a new deck.'}</p>

        <label>Deck name</label>
        <input type="text" id="deckNameInput" placeholder="e.g. Anatomy, French, History" value="${escapeHtml(name)}">

        <label>Color</label>
        <div class="color-picker" id="colorPicker">${colorsHtml}</div>

        <label>Intervals (days)</label>
        <div class="intervals-grid">
            <div>
                <label style="margin-top:0">Again</label>
                <input type="number" step="0.01" id="intAgain" value="${intervals[0]}" min="0.001">
            </div>
            <div>
                <label style="margin-top:0">Hard</label>
                <input type="number" step="0.01" id="intHard" value="${intervals[1]}" min="0.001">
            </div>
            <div>
                <label style="margin-top:0">Good</label>
                <input type="number" step="0.01" id="intGood" value="${intervals[2]}" min="0.001">
            </div>
            <div>
                <label style="margin-top:0">Easy</label>
                <input type="number" step="0.01" id="intEasy" value="${intervals[3]}" min="0.001">
            </div>
        </div>

        <div class="btn-row">
            <button class="btn btn-outline" id="deckCancelBtn">Cancel</button>
            <button class="btn btn-primary" id="deckSaveBtn">${isEditing ? 'Save' : 'Create'}</button>
        </div>
    `;

    openModal(html);

    let selectedColor = color;
    document.querySelectorAll('#colorPicker .color-option').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#colorPicker .color-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedColor = btn.dataset.color;
        });
    });

    document.getElementById('deckCancelBtn').addEventListener('click', closeModal);

    document.getElementById('deckSaveBtn').addEventListener('click', () => {
        const newName = document.getElementById('deckNameInput').value.trim();
        if (!newName) { showToast('Deck name required'); return; }

        const newIntervals = [
            parseFloat(document.getElementById('intAgain').value) || 0.0417,
            parseFloat(document.getElementById('intHard').value) || 1,
            parseFloat(document.getElementById('intGood').value) || 3,
            parseFloat(document.getElementById('intEasy').value) || 7
        ];

        if (isEditing) {
            updateDeck(deckId, { name: newName, color: selectedColor, intervals: newIntervals });
            closeModal();
            renderDeck();
        } else {
            const newId = createDeck(newName, selectedColor);
            updateDeck(newId, { intervals: newIntervals });
            closeModal();
            currentDeckId = newId;
            showView('deck');
        }
    });
}

// ============================================================
// STUDY SESSION
// ============================================================
function startStudy(deckId, mode = 'normal', tagFilter = null) {
    currentDeckId = deckId;
    const deck = state.decks[deckId];
    if (!deck) return;

    let cards;
    if (mode === 'cram') {
        cards = getCardsInDeck(deckId).filter(c => !isBuried(c));
    } else if (mode === 'tag' && tagFilter) {
        cards = getCardsInDeck(deckId).filter(c => !isBuried(c) && (c.tags || []).includes(tagFilter));
    } else {
        cards = getDueCards(deckId);
    }

    if (cards.length === 0) {
        showToast(mode === 'cram' ? 'No cards in this deck' : mode === 'tag' ? 'No cards with this tag' : 'No cards due right now');
        return;
    }

    // Shuffle
    for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }

    studySession = {
        deckId,
        mode,
        queue: cards.map(c => c.id),
        index: 0,
        revealed: false,
        typedAnswer: '',
        typedChecked: false,
        typedCorrect: false,
        results: { again: 0, hard: 0, good: 0, easy: 0 }
    };

    showView('study');
}

function renderStudy() {
    if (!studySession) { showView('home'); return; }

    const body = document.getElementById('studyBody');
    const prog = document.getElementById('studyProgress');

    if (studySession.index >= studySession.queue.length) {
        prog.textContent = `${studySession.queue.length} / ${studySession.queue.length}`;
        renderStudyComplete();
        return;
    }

    prog.textContent = `${studySession.index + 1} / ${studySession.queue.length}`;

    const card = state.cards[studySession.queue[studySession.index]];
    if (!card) {
        studySession.index++;
        renderStudy();
        return;
    }

    const deck = state.decks[card.deckId];
    const intervals = deck?.intervals || [0.0417, 1, 3, 7];
    const labels = ['Again', 'Hard', 'Good', 'Easy'];

    let cardHtml = '';
    let actionsHtml = '';

    if (card.type === 'cloze') {
        cardHtml = `
            <div class="study-label">Cloze</div>
            <div class="study-text">${studySession.revealed ? renderClozeRevealed(card.clozeText) : renderClozeHidden(card.clozeText)}</div>
            ${renderStudyTags(card)}
        `;
        if (!studySession.revealed) {
            actionsHtml = `<button class="btn-reveal" id="revealBtn">Reveal answer</button>`;
        } else {
            actionsHtml = renderRatingButtons(labels, intervals);
        }
    } else if (card.type === 'typing') {
        cardHtml = `
            <div class="study-label">Type the answer</div>
            <div class="study-text">${escapeHtml(card.front)}</div>
            <input type="text" class="study-typing-input" id="typingInput" placeholder="Type your answer..."
                value="${escapeHtml(studySession.typedAnswer)}" autocomplete="off" ${studySession.typedChecked ? 'disabled' : ''}>
            ${studySession.typedChecked ? `
                <div class="study-feedback ${studySession.typedCorrect ? 'correct' : 'wrong'}">
                    ${studySession.typedCorrect ? 'Correct!' : 'The answer is: ' + escapeHtml(card.back)}
                </div>
            ` : ''}
            ${renderStudyTags(card)}
        `;
        if (!studySession.typedChecked) {
            actionsHtml = `<button class="btn-reveal" id="checkBtn">Check answer</button>`;
        } else {
            actionsHtml = renderRatingButtons(labels, intervals);
        }
    } else {
        // basic / reversed
        cardHtml = `
            <div class="study-label">${card.type === 'reversed' ? 'Reversed' : 'Basic'}</div>
            <div class="study-text">${escapeHtml(card.front)}</div>
            ${studySession.revealed ? `<div class="study-answer">${escapeHtml(card.back)}</div>` : ''}
            ${renderStudyTags(card)}
        `;
        if (!studySession.revealed) {
            actionsHtml = `<button class="btn-reveal" id="revealBtn">Reveal answer</button>`;
        } else {
            actionsHtml = renderRatingButtons(labels, intervals);
        }
    }

    body.innerHTML = `
        <div class="study-card">${cardHtml}</div>
        <div class="study-actions">${actionsHtml}</div>
    `;

    bindStudyEvents(card);

    // Focus typing input
    if (card.type === 'typing' && !studySession.typedChecked) {
        const input = document.getElementById('typingInput');
        if (input) input.focus();
    }
}

function renderStudyTags(card) {
    const tags = (card.tags || []).filter(t => t);
    if (tags.length === 0) return '';
    return `<div class="study-tags">${tags.map(t => `<span class="study-tag">#${escapeHtml(t)}</span>`).join('')}</div>`;
}

function renderRatingButtons(labels, intervals) {
    return `
        <div class="rating-buttons">
            ${labels.map((label, i) => `
                <button class="rating-btn" data-rating="${i}">
                    <span class="rating-btn-label">${label}</span>
                    <span class="rating-btn-interval">${formatInterval(intervals[i])}</span>
                </button>
            `).join('')}
        </div>
    `;
}

function bindStudyEvents(card) {
    const revealBtn = document.getElementById('revealBtn');
    if (revealBtn) {
        revealBtn.addEventListener('click', revealCurrent);
    }

    const checkBtn = document.getElementById('checkBtn');
    if (checkBtn) {
        checkBtn.addEventListener('click', checkTyping);
    }

    const typingInput = document.getElementById('typingInput');
    if (typingInput) {
        typingInput.addEventListener('input', () => {
            studySession.typedAnswer = typingInput.value;
        });
        typingInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                checkTyping();
            }
        });
    }

    document.querySelectorAll('.rating-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            rateCard(parseInt(btn.dataset.rating));
        });
    });
}

function revealCurrent() {
    studySession.revealed = true;
    renderStudy();
}

function checkTyping() {
    const card = state.cards[studySession.queue[studySession.index]];
    if (!card) return;
    const typed = (studySession.typedAnswer || '').trim();
    if (!typed) { showToast('Type an answer first'); return; }

    const normalize = s => s.toLowerCase().trim().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ');
    const correct = normalize(typed) === normalize(card.back);

    studySession.typedChecked = true;
    studySession.typedCorrect = correct;
    renderStudy();
}

function rateCard(rating) {
    const card = state.cards[studySession.queue[studySession.index]];
    if (!card) return;
    const deck = state.decks[card.deckId];
    const intervals = deck?.intervals || [0.0417, 1, 3, 7];
    const days = intervals[rating] || 1;

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + days);

    const updates = {
        dueDate: dueDate.toISOString(),
        step: rating,
        history: [...(card.history || []), { ts: nowISO(), rating }]
    };

    if (rating === 0) {
        updates.failCount = (card.failCount || 0) + 1;
    } else {
        updates.failCount = card.failCount || 0;
    }

    updateCard(card.id, updates);

    // Update session result counts
    const resultKey = ['again', 'hard', 'good', 'easy'][rating];
    studySession.results[resultKey]++;

    // Update streak
    updateStreak();

    studySession.revealed = false;
    studySession.typedAnswer = '';
    studySession.typedChecked = false;
    studySession.typedCorrect = false;
    studySession.index++;
    renderStudy();
}

function updateStreak() {
    const today = todayStart().toISOString().slice(0, 10);
    const last = state.studyStreak.lastDate;

    if (last === today) return;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    if (last === yesterdayStr) {
        state.studyStreak.count++;
    } else {
        state.studyStreak.count = 1;
    }
    state.studyStreak.lastDate = today;
    saveState();
}

function renderStudyComplete() {
    const body = document.getElementById('studyBody');
    const r = studySession.results;
    const total = studySession.queue.length;

    body.innerHTML = `
        <div class="study-complete">
            <h2>Session complete</h2>
            <p>You reviewed ${total} ${total === 1 ? 'card' : 'cards'}.</p>
            <div class="study-complete-stats">
                <div class="study-complete-stat">
                    <div class="study-complete-stat-num">${r.again}</div>
                    <div class="study-complete-stat-label">Again</div>
                </div>
                <div class="study-complete-stat">
                    <div class="study-complete-stat-num">${r.hard}</div>
                    <div class="study-complete-stat-label">Hard</div>
                </div>
                <div class="study-complete-stat">
                    <div class="study-complete-stat-num">${r.good}</div>
                    <div class="study-complete-stat-label">Good</div>
                </div>
                <div class="study-complete-stat">
                    <div class="study-complete-stat-num">${r.easy}</div>
                    <div class="study-complete-stat-label">Easy</div>
                </div>
            </div>
            <button class="btn btn-primary" id="finishStudyBtn">Back to deck</button>
        </div>
    `;

    document.getElementById('finishStudyBtn').addEventListener('click', () => {
        studySession = null;
        showView('deck');
    });
}

function exitStudy() {
    studySession = null;
    showView('deck');
}

// ============================================================
// CARD OPTIONS (from deck view)
// ============================================================
function openCardOptions(cardId) {
    const card = state.cards[cardId];
    if (!card) return;
    const decks = Object.values(state.decks).filter(d => d.id !== card.deckId);

    const html = `
        <h2>Card options</h2>
        <p class="modal-sub">${escapeHtml(card.front || card.clozeText || 'Card')}</p>
        <div class="btn-row" style="flex-direction:column;gap:8px;">
            <button class="btn btn-outline" id="optHistory">View history</button>
            <button class="btn btn-outline" id="optBury">${isBuried(card) ? 'Unbury' : 'Bury until tomorrow'}</button>
            <button class="btn btn-outline" id="optDuplicate">Duplicate</button>
            ${decks.length > 0 ? '<button class="btn btn-outline" id="optMove">Move to another deck</button>' : ''}
            <button class="btn btn-outline" id="optCancel">Cancel</button>
        </div>
    `;
    openModal(html);

    document.getElementById('optHistory').addEventListener('click', () => {
        closeModal();
        openCardHistory(cardId);
    });
    document.getElementById('optBury').addEventListener('click', () => {
        closeModal();
        buryCard(cardId);
    });
    document.getElementById('optDuplicate').addEventListener('click', () => {
        closeModal();
        duplicateCard(cardId);
    });
    if (decks.length > 0) {
        document.getElementById('optMove').addEventListener('click', () => {
            closeModal();
            openMoveCard(cardId);
        });
    }
    document.getElementById('optCancel').addEventListener('click', closeModal);
}

function buryCard(cardId) {
    const card = state.cards[cardId];
    if (!card) return;
    if (isBuried(card)) {
        updateCard(cardId, { buried: false, buriedUntil: null });
        showToast('Card unbured');
    } else {
        updateCard(cardId, { buried: true, buriedUntil: tomorrowStart().toISOString() });
        showToast('Buried until tomorrow');
    }
    renderDeck();
}

function duplicateCard(cardId) {
    const card = state.cards[cardId];
    if (!card) return;
    const newData = {
        type: card.type,
        front: card.front,
        back: card.back,
        clozeText: card.clozeText,
        tags: [...(card.tags || [])]
    };
    createCard(card.deckId, newData);
    renderDeck();
    showToast('Card duplicated');
}

function openMoveCard(cardId) {
    const card = state.cards[cardId];
    if (!card) return;
    const decks = Object.values(state.decks).filter(d => d.id !== card.deckId);
    const html = `
        <h2>Move card</h2>
        <p class="modal-sub">Choose a destination deck.</p>
        ${decks.map(d => `<button class="btn btn-outline" style="width:100%;margin-bottom:6px;" data-move-to="${d.id}">${escapeHtml(d.name)}</button>`).join('')}
        <button class="btn btn-outline" id="moveCancelBtn" style="width:100%;margin-top:8px;">Cancel</button>
    `;
    openModal(html);
    document.querySelectorAll('[data-move-to]').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.moveTo;
            updateCard(cardId, { deckId: targetId });
            if (card.siblingId && state.cards[card.siblingId]) {
                updateCard(card.siblingId, { deckId: targetId });
            }
            closeModal();
            renderDeck();
            showToast('Card moved');
        });
    });
    document.getElementById('moveCancelBtn').addEventListener('click', closeModal);
}

function openCardHistory(cardId) {
    const card = state.cards[cardId];
    if (!card) return;
    const history = (card.history || []).slice().reverse();
    const labels = ['Again', 'Hard', 'Good', 'Easy'];
    const html = `
        <h2>Card history</h2>
        <p class="modal-sub">${escapeHtml(card.front || card.clozeText || 'Card')}</p>
        ${history.length === 0 ? '<div class="empty-list">No history yet.</div>' : history.map(h => `
            <div class="list-item">
                <div class="list-item-title">${labels[h.rating] || '—'}</div>
                <div class="list-item-meta">${new Date(h.ts).toLocaleString()}</div>
            </div>
        `).join('')}
        <button class="btn btn-outline" id="historyCloseBtn" style="width:100%;margin-top:16px;">Close</button>
    `;
    openModal(html);
    document.getElementById('historyCloseBtn').addEventListener('click', closeModal);
}

// ============================================================
// STATS MODAL
// ============================================================
function openStats() {
    const allCards = Object.values(state.cards);
    const total = allCards.length;
    const due = allCards.filter(c => isDue(c) && !isBuried(c)).length;
    const leeches = allCards.filter(isLeech).length;

    let totalReviews = 0;
    let correctReviews = 0;
    allCards.forEach(c => {
        (c.history || []).forEach(h => {
            totalReviews++;
            if (h.rating >= 2) correctReviews++;
        });
    });
    const retention = totalReviews > 0 ? Math.round((correctReviews / totalReviews) * 100) : null;

    const learned = allCards.filter(c => (c.step || 0) >= 2).length;

    const html = `
        <h2>Stats</h2>
        <p class="modal-sub">Your study activity at a glance.</p>
        <div class="stats-grid">
            <div class="stats-tile">
                <div class="stats-tile-num">${total}</div>
                <div class="stats-tile-label">Total cards</div>
            </div>
            <div class="stats-tile">
                <div class="stats-tile-num">${due}</div>
                <div class="stats-tile-label">Due today</div>
            </div>
            <div class="stats-tile">
                <div class="stats-tile-num">${retention === null ? '—' : retention + '%'}</div>
                <div class="stats-tile-label">Retention</div>
            </div>
            <div class="stats-tile">
                <div class="stats-tile-num">${totalReviews}</div>
                <div class="stats-tile-label">Reviews</div>
            </div>
            <div class="stats-tile">
                <div class="stats-tile-num">${learned}</div>
                <div class="stats-tile-label">Learned</div>
            </div>
            <div class="stats-tile">
                <div class="stats-tile-num">${leeches}</div>
                <div class="stats-tile-label">Leeches</div>
            </div>
            <div class="stats-tile">
                <div class="stats-tile-num">${state.studyStreak.count || 0}</div>
                <div class="stats-tile-label">Streak (days)</div>
            </div>
        </div>
        <button class="btn btn-outline" id="statsCloseBtn" style="width:100%;margin-top:16px;">Close</button>
    `;
    openModal(html);
    document.getElementById('statsCloseBtn').addEventListener('click', closeModal);
}

// ============================================================
// HARDEST CARDS MODAL
// ============================================================
function openHardest() {
    const cards = Object.values(state.cards)
        .filter(c => (c.failCount || 0) > 0)
        .sort((a, b) => (b.failCount || 0) - (a.failCount || 0))
        .slice(0, 20);

    const html = `
        <h2>Hardest cards</h2>
        <p class="modal-sub">Cards you struggle with most.</p>
        ${cards.length === 0 ? '<div class="empty-list">No failures yet.</div>' : cards.map(c => {
            const deck = state.decks[c.deckId];
            return `
                <div class="list-item" data-card="${c.id}">
                    <div class="list-item-title">${escapeHtml(c.front || c.clozeText || 'Card')}</div>
                    <div class="list-item-meta">${c.failCount} fail${c.failCount === 1 ? '' : 's'} · ${escapeHtml(deck?.name || 'Unknown deck')}</div>
                </div>
            `;
        }).join('')}
        <button class="btn btn-outline" id="hardestCloseBtn" style="width:100%;margin-top:16px;">Close</button>
    `;
    openModal(html);
    document.getElementById('hardestCloseBtn').addEventListener('click', closeModal);
}

// ============================================================
// STUDY BY TAG MODAL
// ============================================================
function openStudyByTag() {
    const cards = getCardsInDeck(currentDeckId);
    const tagSet = new Set();
    cards.forEach(c => (c.tags || []).forEach(t => tagSet.add(t)));
    const tags = Array.from(tagSet).sort();

    const html = `
        <h2>Study by tag</h2>
        <p class="modal-sub">Pick a tag to study only those cards.</p>
        ${tags.length === 0 ? '<div class="empty-list">No tags in this deck yet.</div>' : tags.map(t => `
            <button class="btn btn-outline" style="width:100%;margin-bottom:6px;" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>
        `).join('')}
        <button class="btn btn-outline" id="tagCancelBtn" style="width:100%;margin-top:8px;">Cancel</button>
    `;
    openModal(html);
    document.querySelectorAll('[data-tag]').forEach(btn => {
        btn.addEventListener('click', () => {
            const tag = btn.dataset.tag;
            closeModal();
            startStudy(currentDeckId, 'tag', tag);
        });
    });
    document.getElementById('tagCancelBtn').addEventListener('click', closeModal);
}

// ============================================================
// SETTINGS
// ============================================================
function renderSettings() {
    const driveClient = localStorage.getItem(DRIVE_CLIENT_KEY) || '';
    const driveToken = localStorage.getItem(DRIVE_TOKEN_KEY) || '';
    document.getElementById('driveClientId').value = driveClient;
    updateDriveButtons(!!driveToken);
    loadVersion();
}

function updateDriveButtons(connected) {
    document.getElementById('drivePushBtn').disabled = !connected;
    document.getElementById('drivePullBtn').disabled = !connected;
    document.getElementById('connectDriveBtn').textContent = connected ? 'Reconnect' : 'Connect';
}

async function loadVersion() {
    try {
        const res = await fetch('sw.js', { cache: 'no-store' });
        const text = await res.text();
        const m = text.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
        if (m) document.getElementById('appVersion').textContent = m[1];
    } catch (e) {}
}

// ============================================================
// GOOGLE DRIVE
// ============================================================
function connectDrive() {
    const clientId = document.getElementById('driveClientId').value.trim();
    if (!clientId) { showToast('Enter client ID first'); return; }
    localStorage.setItem(DRIVE_CLIENT_KEY, clientId);

    if (typeof google === 'undefined') {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.onload = initDriveAuth;
        s.onerror = () => showToast('Failed to load Google');
        document.head.appendChild(s);
    } else initDriveAuth();
}

function initDriveAuth() {
    const clientId = localStorage.getItem(DRIVE_CLIENT_KEY);
    try {
        const tc = google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: 'https://www.googleapis.com/auth/drive.file',
            callback: (resp) => {
                if (resp.access_token) {
                    localStorage.setItem(DRIVE_TOKEN_KEY, resp.access_token);
                    document.getElementById('driveStatus').textContent = 'Connected';
                    updateDriveButtons(true);
                    showToast('Drive connected');
                }
            },
        });
        tc.requestAccessToken();
    } catch (e) {
        showToast('Drive init failed');
    }
}

async function drivePush() {
    const token = localStorage.getItem(DRIVE_TOKEN_KEY);
    if (!token) return;
    document.getElementById('driveStatus').textContent = 'Backing up...';
    try {
        const folderId = await getOrCreateDriveFolder(token);
        const backup = { state, exportedAt: nowISO() };
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify({ name: 'cjaycards_backup.json', parents: [folderId] })], { type: 'application/json' }));
        form.append('file', new Blob([JSON.stringify(backup)], { type: 'application/json' }));
        const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: form
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        document.getElementById('driveStatus').textContent = 'Backed up successfully';
        showToast('Backed up to Drive');
    } catch (e) {
        document.getElementById('driveStatus').textContent = 'Backup failed';
        showToast('Backup failed');
    }
}

async function drivePull() {
    const token = localStorage.getItem(DRIVE_TOKEN_KEY);
    if (!token) return;
    document.getElementById('driveStatus').textContent = 'Restoring...';
    try {
        const folderId = await getOrCreateDriveFolder(token);
        const search = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=name='cjaycards_backup.json' and '${folderId}' in parents and trashed=false`,
            { headers: { 'Authorization': 'Bearer ' + token } }
        );
        const sdata = await search.json();
        if (!sdata.files || sdata.files.length === 0) {
            document.getElementById('driveStatus').textContent = 'No backup found';
            return;
        }
        const fileId = sdata.files[0].id;
        const dres = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const backup = await dres.json();
        if (!backup.state) throw new Error('Invalid backup');
        if (!confirm('Replace all local data with this backup?')) return;
        state = backup.state;
        if (!state.deletedIds) state.deletedIds = { decks: [], cards: [] };
        if (!state.studyStreak) state.studyStreak = { lastDate: null, count: 0 };
        saveState();
        renderHome();
        document.getElementById('driveStatus').textContent = 'Restored from Drive';
        showToast('Restored from Drive');
    } catch (e) {
        document.getElementById('driveStatus').textContent = 'Restore failed';
        showToast('Restore failed');
    }
}

async function getOrCreateDriveFolder(token) {
    const s = await fetch(
        "https://www.googleapis.com/drive/v3/files?q=name='CjayCards' and mimeType='application/vnd.google-apps.folder' and trashed=false",
        { headers: { 'Authorization': 'Bearer ' + token } }
    );
    const sd = await s.json();
    if (sd.files && sd.files.length > 0) return sd.files[0].id;
    const c = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'CjayCards', mimeType: 'application/vnd.google-apps.folder' })
    });
    const cd = await c.json();
    return cd.id;
}

// ============================================================
// JSON BACKUP
// ============================================================
function exportJson() {
    const backup = { state, exportedAt: nowISO() };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cjaycards_backup_${nowISO().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported');
}

function importJson() {
    document.getElementById('backupInput').click();
}

// ============================================================
// RESET
// ============================================================
function resetAll() {
    if (!confirm('Delete all decks and cards? This cannot be undone.')) return;
    state = getDefaultState();
    saveState();
    renderHome();
    showToast('All data cleared');
}

// ============================================================
// WIRE FORMAT (Phase 2 prep — not called yet)
// ============================================================
function toWireFormat() {
    return {
        collections: {
            decks: Object.values(state.decks),
            cards: Object.values(state.cards)
        },
        deletedIds: {
            decks: state.deletedIds.decks,
            cards: state.deletedIds.cards
        },
        settings: { theme: getStoredTheme() }
    };
}

function fromWireFormat(wire) {
    const decks = {};
    const cards = {};
    (wire.collections?.decks || []).forEach(d => { decks[d.id] = d; });
    (wire.collections?.cards || []).forEach(c => { cards[c.id] = c; });
    return {
        decks,
        cards,
        deletedIds: {
            decks: wire.deletedIds?.decks || [],
            cards: wire.deletedIds?.cards || []
        }
    };
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
function handleKeyboard(e) {
    // Don't fire in inputs
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
        if (e.key === 'Escape') { e.target.blur(); }
        return;
    }

    if (e.key === 'Escape') {
        closeAllPopups();
        if (document.getElementById('modalOverlay').classList.contains('active')) {
            closeModal();
        } else if (currentView === 'study') {
            exitStudy();
        } else if (currentView === 'deck') {
            showView('home');
        }
        return;
    }

    if (currentView === 'study' && studySession) {
        if (e.code === 'Space') {
            e.preventDefault();
            if (!studySession.revealed && !studySession.typedChecked) {
                const card = state.cards[studySession.queue[studySession.index]];
                if (card && card.type === 'typing') checkTyping();
                else revealCurrent();
            }
            return;
        }
        if (['1', '2', '3', '4'].includes(e.key)) {
            const card = state.cards[studySession.queue[studySession.index]];
            if (!card) return;
            if (studySession.revealed || studySession.typedChecked) {
                rateCard(parseInt(e.key) - 1);
            }
        }
        return;
    }

    if (currentView === 'deck' && e.key.toLowerCase() === 'n') {
        openCardEditor(null);
    }
}

// ============================================================
// EVENT BINDING
// ============================================================
function bindEvents() {
    // Brand → home
    document.getElementById('brandBtn').addEventListener('click', () => {
        currentDeckId = null;
        showView('home');
    });

    // Theme
    document.getElementById('themeBtn').addEventListener('click', toggleTheme);

    // Main menu
    const menuBtn = document.getElementById('menuBtn');
    const popupMenu = document.getElementById('popupMenu');
    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = popupMenu.classList.contains('open');
        closeAllPopups();
        if (!isOpen) popupMenu.classList.add('open');
    });
    document.addEventListener('click', (e) => {
        if (!popupMenu.contains(e.target) && !menuBtn.contains(e.target)) {
            popupMenu.classList.remove('open');
        }
    });
    popupMenu.querySelectorAll('.popup-item').forEach(item => {
        item.addEventListener('click', () => {
            popupMenu.classList.remove('open');
            const action = item.dataset.menu;
            if (action === 'stats') openStats();
            else if (action === 'hardest') openHardest();
            else if (action === 'settings') showView('settings');
        });
    });

    // Home: new deck
    document.getElementById('newDeckBtn').addEventListener('click', () => openDeckEditor(null));

    // Deck: back, study, menu
    document.getElementById('backFromDeckBtn').addEventListener('click', () => showView('home'));
    document.getElementById('startStudyBtn').addEventListener('click', () => startStudy(currentDeckId));

    const deckMenuBtn = document.getElementById('deckMenuBtn');
    const deckMenu = document.getElementById('deckMenu');
    deckMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = deckMenu.classList.contains('open');
        closeAllPopups();
        if (!isOpen) deckMenu.classList.add('open');
    });
    document.addEventListener('click', (e) => {
        if (!deckMenu.contains(e.target) && !deckMenuBtn.contains(e.target)) {
            deckMenu.classList.remove('open');
        }
    });
    deckMenu.querySelectorAll('.popup-item').forEach(item => {
        item.addEventListener('click', () => {
            deckMenu.classList.remove('open');
            const action = item.dataset.deckAction;
            if (action === 'tag') openStudyByTag();
            else if (action === 'cram') startStudy(currentDeckId, 'cram');
            else if (action === 'edit') openDeckEditor(currentDeckId);
            else if (action === 'delete') {
                if (confirm(`Delete "${state.decks[currentDeckId]?.name}" and all its cards?`)) {
                    deleteDeck(currentDeckId);
                    currentDeckId = null;
                    showView('home');
                }
            }
        });
    });

    // Deck: filters
    document.querySelectorAll('#cardFilters .filter-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            cardFilter = btn.dataset.filter;
            renderDeck();
        });
    });

    // Deck: new card
    document.getElementById('newCardBtn').addEventListener('click', () => openCardEditor(null));

    // Study: exit
    document.getElementById('exitStudyBtn').addEventListener('click', exitStudy);

    // Settings
    document.getElementById('backFromSettingsBtn').addEventListener('click', () => showView('home'));
    document.querySelectorAll('.group-header').forEach(h => {
        h.addEventListener('click', function() {
            const content = this.nextElementSibling;
            const icon = this.querySelector('.toggle-icon');
            if (content.classList.contains('open')) {
                content.classList.remove('open');
                icon.classList.remove('open');
            } else {
                content.classList.add('open');
                icon.classList.add('open');
            }
        });
    });

    document.getElementById('connectDriveBtn').addEventListener('click', connectDrive);
    document.getElementById('drivePushBtn').addEventListener('click', drivePush);
    document.getElementById('drivePullBtn').addEventListener('click', drivePull);
    document.getElementById('exportBtn').addEventListener('click', exportJson);
    document.getElementById('importBtn').addEventListener('click', importJson);
    document.getElementById('resetBtn').addEventListener('click', resetAll);

    document.getElementById('backupInput').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const backup = JSON.parse(ev.target.result);
                if (!backup.state) throw new Error('Invalid');
                if (!confirm('Replace all local data with this backup?')) return;
                state = backup.state;
                if (!state.deletedIds) state.deletedIds = { decks: [], cards: [] };
                if (!state.studyStreak) state.studyStreak = { lastDate: null, count: 0 };
                saveState();
                renderHome();
                showToast('Imported from backup');
            } catch (err) {
                showToast('Invalid backup file');
            }
        };
        reader.readAsText(file);
        this.value = '';
    });

    // Modal
    document.getElementById('modalOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });

    // Undo
    document.getElementById('undoBtn').addEventListener('click', undoDeleteCard);

    // Update toast
    const refreshBtn = document.getElementById('updateRefreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
            } else {
                window.location.reload();
            }
        });
    }

    // Keyboard
    document.addEventListener('keydown', handleKeyboard);
}

// ============================================================
// ONLINE / OFFLINE
// ============================================================
function updateOnlineStatus() {
    const banner = document.getElementById('offlineBanner');
    if (navigator.onLine) banner.classList.remove('show');
    else banner.classList.add('show');
}

// ============================================================
// SERVICE WORKER
// ============================================================
function initSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js', { scope: './' }).then(reg => {
        reg.addEventListener('updatefound', () => {
            const nw = reg.installing;
            nw.addEventListener('statechange', () => {
                if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                    const toast = document.getElementById('updateToast');
                    toast.classList.add('show');
                    setTimeout(() => toast.classList.remove('show'), 5000);
                }
            });
        });
    }).catch(() => {});
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
    });
}

// ============================================================
// BOOT
// ============================================================
applyTheme();
bindEvents();
renderHome();
updateOnlineStatus();
initSW();

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
