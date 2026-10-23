/* ============================================================
   CjayCards — storage layer
   Pure data. No DOM. Schema v1.
   ============================================================ */

(function (global) {
  'use strict';

  const KEY = 'cjaycards.data.v1';
  const SCHEMA_VERSION = 1;
  const DEFAULT_INTERVALS = [0.0417, 1, 3, 7]; // ~1h, 1d, 3d, 7d
  const DECK_COLORS = ['#3D9BC9', '#E5484D', '#10A96B', '#D97706', '#8B5CF6', '#EC4899'];
  const MAX_REVIEWS = 2000;

  /* ---------------------------------------------------------- */
  /* Dummy data (?view=1)                                        */
  /* ---------------------------------------------------------- */
  const DUMMY = {
    version: 1,
    decks: [
      { id: 'demo-anat', name: 'Anatomy', color: '#3D9BC9', intervals: [...DEFAULT_INTERVALS], createdAt: '2026-01-15T08:00:00Z' },
      { id: 'demo-biochem', name: 'Biochemistry', color: '#10A96B', intervals: [...DEFAULT_INTERVALS], createdAt: '2026-01-15T08:00:00Z' },
      { id: 'demo-physio', name: 'Physiology', color: '#D97706', intervals: [...DEFAULT_INTERVALS], createdAt: '2026-02-01T08:00:00Z' }
    ],
    cards: [
      { id: 'c1', deckId: 'demo-anat', front: 'Which muscle flexes the forearm at the elbow?', back: 'Biceps brachii', tags: ['upper-limb'], dueDate: isoDaysFromNow(-1), easyStreak: 1, manuallyMastered: false, createdAt: '2026-01-15T08:00:00Z', updatedAt: '2026-01-15T08:00:00Z', lastReviewedAt: isoDaysFromNow(-2) },
      { id: 'c2', deckId: 'demo-anat', front: 'What nerve innervates the diaphragm?', back: 'Phrenic nerve (C3, C4, C5)', tags: ['thorax', 'high-yield'], dueDate: isoDaysFromNow(3), easyStreak: 3, manuallyMastered: false, createdAt: '2026-01-15T08:00:00Z', updatedAt: '2026-01-15T08:00:00Z', lastReviewedAt: isoDaysFromNow(-1) },
      { id: 'c3', deckId: 'demo-biochem', front: 'Rate-limiting enzyme of glycolysis?', back: 'Phosphofructokinase-1 (PFK-1)', tags: ['metabolism'], dueDate: isoDaysFromNow(0), easyStreak: 0, manuallyMastered: false, createdAt: '2026-01-15T08:00:00Z', updatedAt: '2026-01-15T08:00:00Z', lastReviewedAt: isoDaysFromNow(-1) },
      { id: 'c4', deckId: 'demo-biochem', front: 'What vitamin is a cofactor for pyruvate dehydrogenase?', back: 'Thiamine (B1)', tags: [], dueDate: isoDaysFromNow(1), easyStreak: 1, manuallyMastered: false, createdAt: '2026-01-15T08:00:00Z', updatedAt: '2026-01-15T08:00:00Z', lastReviewedAt: isoDaysFromNow(-2) },
      { id: 'c5', deckId: 'demo-physio', front: 'Which ion primarily drives the plateau phase of the cardiac action potential?', back: 'Calcium (Ca²⁺)', tags: ['cardio'], dueDate: isoDaysFromNow(-2), easyStreak: 0, manuallyMastered: false, createdAt: '2026-02-01T08:00:00Z', updatedAt: '2026-02-01T08:00:00Z', lastReviewedAt: isoDaysFromNow(-3) },
      { id: 'c6', deckId: 'demo-physio', front: 'Normal resting membrane potential of a neuron?', back: 'About −70 mV', tags: [], dueDate: isoDaysFromNow(5), easyStreak: 2, manuallyMastered: false, createdAt: '2026-02-01T08:00:00Z', updatedAt: '2026-02-01T08:00:00Z', lastReviewedAt: isoDaysFromNow(-1) }
    ],
    reviews: [
      { id: 'r1', cardId: 'c1', deckId: 'demo-anat', rating: 1, at: isoDaysFromNow(-2) },
      { id: 'r2', cardId: 'c2', deckId: 'demo-anat', rating: 3, at: isoDaysFromNow(-1) },
      { id: 'r3', cardId: 'c3', deckId: 'demo-biochem', rating: 0, at: isoDaysFromNow(-1) },
      { id: 'r4', cardId: 'c4', deckId: 'demo-biochem', rating: 2, at: isoDaysFromNow(-2) },
      { id: 'r5', cardId: 'c6', deckId: 'demo-physio', rating: 3, at: isoDaysFromNow(-1) }
    ],
    settings: { family: 'slate', mode: 'light', lastSync: null }
  };

  function isoDaysFromNow(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString();
  }

  /* ---------------------------------------------------------- */
  /* Core                                                        */
  /* ---------------------------------------------------------- */
  function defaultData() {
    return {
      version: SCHEMA_VERSION,
      decks: [],
      cards: [],
      reviews: [],
      settings: { family: 'slate', mode: 'light', lastSync: null }
    };
  }

  function readRaw() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch (e) {
      console.warn('Storage read failed:', e);
      return null;
    }
  }

  function writeRaw(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('Storage write failed:', e);
      return false;
    }
  }

  function read() {
    const raw = readRaw();
    if (!raw) return defaultData();
    const merged = { ...defaultData(), ...raw };
    if (!Array.isArray(merged.decks)) merged.decks = [];
    if (!Array.isArray(merged.cards)) merged.cards = [];
    if (!Array.isArray(merged.reviews)) merged.reviews = [];
    return merged;
  }

  function write(data) { return writeRaw(data); }

  /* ---------------------------------------------------------- */
  /* Helpers                                                     */
  /* ---------------------------------------------------------- */
  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function nowISO() { return new Date().toISOString(); }

  /* ---------------------------------------------------------- */
  /* Due / mastery / streak                                      */
  /* ---------------------------------------------------------- */
  function isDue(card) {
    if (!card || !card.dueDate) return true;
    return new Date(card.dueDate).getTime() <= Date.now();
  }

  function isMastered(card) {
    if (!card) return false;
    if (card.manuallyMastered) return true;
    return (card.easyStreak || 0) >= 3;
  }

  function dueCardsOf(data, deckId = null) {
    const list = deckId
      ? data.cards.filter((c) => c.deckId === deckId)
      : data.cards;
    return list.filter(isDue);
  }

  function totalDueCount(data) {
    return dueCardsOf(data).length;
  }

  function masteredCount(data, deckId = null) {
    const list = deckId
      ? data.cards.filter((c) => c.deckId === deckId)
      : data.cards;
    return list.filter(isMastered).length;
  }

  function streak(data) {
    if (!data.reviews || !data.reviews.length) return 0;
    const days = new Set();
    data.reviews.forEach((r) => {
      const d = new Date(r.at);
      if (isNaN(d)) return;
      days.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    });

    function fmt(d) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    let cursor = new Date();
    let count = 0;
    if (!days.has(fmt(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
      if (!days.has(fmt(cursor))) return 0;
    }
    while (days.has(fmt(cursor))) {
      count++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }

  function heatmapData(data, days = 90) {
    const counts = {};
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));

    (data.reviews || []).forEach((r) => {
      const d = new Date(r.at);
      if (isNaN(d)) return;
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      counts[k] = (counts[k] || 0) + 1;
    });
    return { counts, start };
  }

  /* ---------------------------------------------------------- */
  /* Public API                                                  */
  /* ---------------------------------------------------------- */
  const api = {
    SCHEMA_VERSION,
    DEFAULT_INTERVALS,
    DECK_COLORS,

    getData() { return read(); },
    setData(data) { return write(data); },
    reset() { return write(defaultData()); },

    /* Decks */
    addDeck({ name, color }) {
      const data = read();
      const deck = {
        id: uuid(),
        name: String(name || '').trim() || 'Untitled Deck',
        color: color || DECK_COLORS[data.decks.length % DECK_COLORS.length],
        intervals: [...DEFAULT_INTERVALS],
        createdAt: nowISO()
      };
      data.decks.push(deck);
      write(data);
      return deck;
    },

    updateDeck(id, patch) {
      const data = read();
      const idx = data.decks.findIndex((d) => d.id === id);
      if (idx === -1) return null;
      data.decks[idx] = { ...data.decks[idx], ...patch, id };
      write(data);
      return data.decks[idx];
    },

    removeDeck(id) {
      const data = read();
      data.decks = data.decks.filter((d) => d.id !== id);
      data.cards = data.cards.filter((c) => c.deckId !== id);
      data.reviews = data.reviews.filter((r) => r.deckId !== id);
      write(data);
    },

    getDeck(id) {
      return read().decks.find((d) => d.id === id) || null;
    },

    /* Cards */
    addCard({ deckId, front, back, tags }) {
      const data = read();
      const card = {
        id: uuid(),
        deckId,
        front: String(front || '').trim(),
        back: String(back || '').trim(),
        tags: Array.isArray(tags) ? tags : [],
        dueDate: nowISO(),
        easyStreak: 0,
        manuallyMastered: false,
        createdAt: nowISO(),
        updatedAt: nowISO(),
        lastReviewedAt: null
      };
      data.cards.push(card);
      write(data);
      return card;
    },

    updateCard(id, patch) {
      const data = read();
      const idx = data.cards.findIndex((c) => c.id === id);
      if (idx === -1) return null;
      data.cards[idx] = { ...data.cards[idx], ...patch, id, updatedAt: nowISO() };
      write(data);
      return data.cards[idx];
    },

    removeCard(id) {
      const data = read();
      data.cards = data.cards.filter((c) => c.id !== id);
      data.reviews = data.reviews.filter((r) => r.cardId !== id);
      write(data);
    },

    getCard(id) {
      return read().cards.find((c) => c.id === id) || null;
    },

    cardsOf(deckId) {
      return read().cards.filter((c) => c.deckId === deckId);
    },

    /* Study — rating scale 0=Again 1=Hard 2=Good 3=Easy */
    rateCard(cardId, rating) {
      const data = read();
      const idx = data.cards.findIndex((c) => c.id === cardId);
      if (idx === -1) return null;

      const card = data.cards[idx];
      const deck = data.decks.find((d) => d.id === card.deckId);
      if (!deck) return null;

      const intervalDays = deck.intervals[rating] ?? 1;
      const due = new Date();
      due.setTime(due.getTime() + intervalDays * 24 * 60 * 60 * 1000);

      // Mastery tracking
      let easyStreak = card.easyStreak || 0;
      if (rating === 3) easyStreak += 1;
      else easyStreak = 0;

      data.cards[idx] = {
        ...card,
        dueDate: due.toISOString(),
        easyStreak,
        lastReviewedAt: nowISO(),
        updatedAt: nowISO()
      };

      // Log review
      data.reviews.push({
        id: uuid(),
        cardId,
        deckId: card.deckId,
        rating,
        at: nowISO()
      });
      if (data.reviews.length > MAX_REVIEWS) {
        data.reviews = data.reviews.slice(-MAX_REVIEWS);
      }

      write(data);
      return data.cards[idx];
    },

    resetCardProgress(cardId) {
      return api.updateCard(cardId, {
        dueDate: nowISO(),
        easyStreak: 0
      });
    },

    resetDeckProgress(deckId) {
      const data = read();
      data.cards = data.cards.map((c) =>
        c.deckId === deckId
          ? { ...c, dueDate: nowISO(), easyStreak: 0, lastReviewedAt: null }
          : c
      );
      write(data);
    },

    /* Settings */
    getSettings() { return read().settings; },
    updateSettings(patch) {
      const data = read();
      data.settings = { ...data.settings, ...patch };
      write(data);
      return data.settings;
    },

    /* Derived */
    isDue,
    isMastered,
    dueCardsOf,
    totalDueCount,
    masteredCount,
    streak,
    heatmapData,

    /* Demo */
    getDummyData() { return JSON.parse(JSON.stringify(DUMMY)); },

    /* Debug */
    _raw: { read, write, readRaw, writeRaw, KEY, defaultData }
  };

  global.Storage = api;
})(window);
