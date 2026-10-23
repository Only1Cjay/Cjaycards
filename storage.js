// ============================================================
// STORAGE LAYER — CjayCards Phase 1
// ============================================================
const STORAGE_KEY = 'cjaycards_data';
const THEME_KEY = 'cjaycards_theme';
const DRIVE_CLIENT_KEY = 'cjaycards_drive_client';
const DRIVE_TOKEN_KEY = 'cjaycards_drive_token';

/**
 * Default state structure for new installs or resets.
 * Includes `deletedIds` for Phase 2 Cloudflare Sync tombstones,
 * and `studyStreak` for the new stats feature.
 */
function getDefaultState() {
    return {
        decks: {},
        cards: {},
        deletedIds: { decks: [], cards: [] },
        studyStreak: { lastDate: null, count: 0 }
    };
}

/**
 * Load state from localStorage, migrating old data if necessary.
 */
function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            
            // Migrations for Phase 1 upgrades
            if (!parsed.decks) parsed.decks = {};
            if (!parsed.cards) parsed.cards = {};
            if (!parsed.deletedIds) parsed.deletedIds = { decks: [], cards: [] };
            if (!parsed.studyStreak) parsed.studyStreak = { lastDate: null, count: 0 };
            
            // Migrate old cards to ensure they have the new required fields
            for (const id in parsed.cards) {
                const card = parsed.cards[id];
                if (!card.type) card.type = 'basic';
                if (!card.history) card.history = [];
                if (card.failCount === undefined) card.failCount = 0;
                if (card.buried === undefined) card.buried = false;
                if (card.buriedUntil === undefined) card.buriedUntil = null;
                if (card.siblingId === undefined) card.siblingId = null;
                if (!card.updatedAt) card.updatedAt = card.createdAt || new Date().toISOString();
            }

            // Migrate old decks to ensure they have timestamps
            for (const id in parsed.decks) {
                const deck = parsed.decks[id];
                if (!deck.updatedAt) deck.updatedAt = deck.createdAt || new Date().toISOString();
            }

            return parsed;
        }
    } catch (e) {
        console.error('[storage] Failed to load state:', e);
    }
    return getDefaultState();
}

/**
 * Save the entire state to localStorage.
 */
function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        console.error('[storage] Failed to save state:', e);
        // Optional: Toast error if storage is full
    }
}
