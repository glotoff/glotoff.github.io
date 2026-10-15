(() => {
  'use strict';

  const STORAGE_KEY = 'travel_fx_state_v1';
  const HISTORY_DEBOUNCE_MS = 1500;
  const MAX_HISTORY_ITEMS = 50;

  const DEFAULT_CURRENCIES = [
    'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'HKD', 'SGD',
    'THB', 'VND', 'KRW', 'TWD', 'MYR', 'IDR', 'PHP', 'INR', 'AED', 'SAR',
    'TRY', 'ILS', 'EGP', 'MAD', 'ZAR', 'MXN', 'BRL', 'ARS', 'CLP', 'COP',
    'PEN', 'CRC', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON',
    'ISK'
  ];

  function createDefaultState() {
    return {
      sourceCurrency: 'JPY',
      customCurrencies: [],
      lastFetchedAt: null,
      targets: [
        {
          id: 'slot-1',
          enabled: true,
          currency: 'USD',
          rateInput: '150',
          direction: 'TARGET_TO_SOURCE' // 1 USD = 150 JPY
        },
        {
          id: 'slot-2',
          enabled: true,
          currency: 'EUR',
          rateInput: '162',
          direction: 'TARGET_TO_SOURCE' // 1 EUR = 162 JPY
        },
        {
          id: 'slot-3',
          enabled: false,
          currency: 'GBP',
          rateInput: '190',
          direction: 'TARGET_TO_SOURCE'
        }
      ],
      history: []
    };
  }

  let state = loadState();
  let currentSourceAmount = null; // numeric value or null
  let lastEditedField = { type: 'source', slotId: null };
  let historyDebounceTimer = null;
  let deferredInstallPrompt = null;

  // DOM Elements
  const sourceCurrencySelect = document.getElementById('source-currency-select');
  const sourceAmountInput = document.getElementById('source-amount-input');
  const clearAmountsBtn = document.getElementById('clear-amounts-btn');
  const targetsListEl = document.getElementById('targets-list');
  const addTargetBtn = document.getElementById('add-target-btn');
  const fetchRatesBtn = document.getElementById('fetch-rates-btn');
  const fetchRatesLabel = document.getElementById('fetch-rates-label');
  const rateStatusText = document.getElementById('rate-status-text');
  const historyListEl = document.getElementById('history-list');
  const clearHistoryBtn = document.getElementById('clear-history-btn');
  const installBtn = document.getElementById('install-btn');
  const shareBtn = document.getElementById('share-btn');

  // --- Persistence ---
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createDefaultState();
      const parsed = JSON.parse(raw);
      const def = createDefaultState();

      const sourceCurrency = typeof parsed.sourceCurrency === 'string' && parsed.sourceCurrency.trim()
        ? parsed.sourceCurrency.trim().toUpperCase()
        : def.sourceCurrency;

      const customCurrencies = Array.isArray(parsed.customCurrencies)
        ? parsed.customCurrencies.filter(c => typeof c === 'string' && /^[A-Z]{3}$/.test(c))
        : [];

      const targets = [0, 1, 2].map(idx => {
        const savedSlot = Array.isArray(parsed.targets) ? parsed.targets[idx] : null;
        const fallback = def.targets[idx];
        if (!savedSlot || typeof savedSlot !== 'object') return fallback;
        return {
          id: `slot-${idx + 1}`,
          enabled: idx === 0 ? true : Boolean(savedSlot.enabled),
          currency: typeof savedSlot.currency === 'string' && savedSlot.currency.trim()
            ? savedSlot.currency.trim().toUpperCase()
            : fallback.currency,
          rateInput: savedSlot.rateInput !== undefined && savedSlot.rateInput !== null
            ? String(savedSlot.rateInput)
            : fallback.rateInput,
          direction: savedSlot.direction === 'SOURCE_TO_TARGET' || savedSlot.direction === 'TARGET_TO_SOURCE'
            ? savedSlot.direction
            : fallback.direction
        };
      });

      const history = Array.isArray(parsed.history)
        ? parsed.history.slice(0, MAX_HISTORY_ITEMS)
        : [];

      return {
        sourceCurrency,
        customCurrencies,
        lastFetchedAt: typeof parsed.lastFetchedAt === 'number' ? parsed.lastFetchedAt : null,
        targets,
        history
      };
    } catch {
      return createDefaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore quota errors in restricted WebViews
    }
  }

  // --- Currency Options Helpers ---
  function getAllCurrencies() {
    const set = new Set(DEFAULT_CURRENCIES);
    for (const code of state.customCurrencies) {
      set.add(code);
    }
    set.add(state.sourceCurrency);
    for (const t of state.targets) {
      set.add(t.currency);
    }
    return Array.from(set);
  }

  function buildCurrencyOptionsHtml(selectedCode) {
    const list = getAllCurrencies();
    const options = list.map(code => {
      const isSelected = code === selectedCode ? ' selected' : '';
      return `<option value="${code}"${isSelected}>${code}</option>`;
    });
    options.push('<option value="__CUSTOM__">+ Custom...</option>');
    return options.join('');
  }

  function promptCustomCurrency(fallbackCode) {
    const input = window.prompt('Enter 3-letter ISO currency code (e.g. GEL, LKR, UYU):', '');
    if (!input) return fallbackCode;
    const cleaned = input.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(cleaned)) {
      window.alert('Please enter a valid 3-letter currency code (A–Z).');
      return fallbackCode;
    }
    if (!DEFAULT_CURRENCIES.includes(cleaned) && !state.customCurrencies.includes(cleaned)) {
      state.customCurrencies.push(cleaned);
    }
    return cleaned;
  }

  // --- Number Parsing & Formatting ---
  function sanitizeNumericInput(raw) {
    if (typeof raw !== 'string') return '';
    // Normalize comma to dot for international decimal keyboards
    const normalized = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '');
    const firstDot = normalized.indexOf('.');
    if (firstDot === -1) return normalized;
    return normalized.slice(0, firstDot + 1) + normalized.slice(firstDot + 1).replace(/\./g, '');
  }

  function parsePositiveNumber(raw) {
    const cleaned = sanitizeNumericInput(String(raw ?? ''));
    if (!cleaned || cleaned === '.') return null;
    const num = Number(cleaned);
    if (!Number.isFinite(num) || num <= 0) return null;
    return num;
  }

  function formatAmount(value) {
    if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
      return '';
    }
    if (value >= 100) {
      // Up to 2 decimals, strip unnecessary .00
      return Number(value.toFixed(2)).toString();
    }
    if (value >= 1) {
      return Number(value.toFixed(2)).toString();
    }
    // Fractional amounts < 1: keep up to 4 significant figures or 6 decimals
    return Number(value.toPrecision(4)).toString();
  }

  function formatDisplayAmountWithCommas(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '0';
    const abs = Math.abs(value);
    const maxDecimals = abs >= 1 ? 2 : 4;
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxDecimals
    });
  }

  function formatRateNumber(rate) {
    if (!Number.isFinite(rate) || rate <= 0) return '';
    if (rate >= 100) return Number(rate.toFixed(2)).toString();
    if (rate >= 1) return Number(rate.toFixed(4)).toString();
    return Number(rate.toPrecision(4)).toString();
  }

  // --- Conversion Math ---
  // Returns targetAmount given sourceAmount and slot
  function computeTargetFromSource(sourceAmt, slot) {
    const rate = parsePositiveNumber(slot.rateInput);
    if (sourceAmt === null || rate === null) return null;
    if (slot.direction === 'SOURCE_TO_TARGET') {
      // 1 Source = rate Target
      return sourceAmt * rate;
    } else {
      // 1 Target = rate Source
      return sourceAmt / rate;
    }
  }

  // Returns sourceAmount given targetAmount and slot
  function computeSourceFromTarget(targetAmt, slot) {
    const rate = parsePositiveNumber(slot.rateInput);
    if (targetAmt === null || rate === null) return null;
    if (slot.direction === 'SOURCE_TO_TARGET') {
      // 1 Source = rate Target => Source = Target / rate
      return targetAmt / rate;
    } else {
      // 1 Target = rate Source => Source = Target * rate
      return targetAmt * rate;
    }
  }

  function getRateSummaryText(slot) {
    const rate = parsePositiveNumber(slot.rateInput);
    if (!rate) return '';
    if (slot.direction === 'SOURCE_TO_TARGET') {
      return `1 ${state.sourceCurrency} = ${formatRateNumber(rate)} ${slot.currency}`;
    }
    return `1 ${slot.currency} = ${formatRateNumber(rate)} ${state.sourceCurrency}`;
  }

  // --- UI Rendering ---
  function renderStatusSubtitle(customMessage, level) {
    if (customMessage) {
      rateStatusText.textContent = customMessage;
      rateStatusText.className = `brand-subtitle ${level === 'ok' ? 'status-ok' : level === 'warn' ? 'status-warn' : ''}`;
      return;
    }
    rateStatusText.className = 'brand-subtitle';
    if (state.lastFetchedAt) {
      const d = new Date(state.lastFetchedAt);
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      rateStatusText.textContent = `Rates persisted • Last fetched ${dateStr} ${timeStr}`;
    } else {
      rateStatusText.textContent = 'Saved rates • Offline ready';
    }
  }

  function renderSourceSelect() {
    sourceCurrencySelect.innerHTML = buildCurrencyOptionsHtml(state.sourceCurrency);
    sourceCurrencySelect.value = state.sourceCurrency;
  }

  function renderTargets() {
    const enabledTargets = state.targets.filter(t => t.enabled);
    const canRemove = enabledTargets.length > 1;

    targetsListEl.innerHTML = enabledTargets.map((slot, index) => {
      const targetAmt = computeTargetFromSource(currentSourceAmount, slot);
      const formattedAmt = formatAmount(targetAmt);
      const hasValidRate = parsePositiveNumber(slot.rateInput) !== null;

      const dirLabel = slot.direction === 'SOURCE_TO_TARGET'
        ? `1 ${state.sourceCurrency} ⇄`
        : `1 ${slot.currency} ⇄`;

      const unitLabel = slot.direction === 'SOURCE_TO_TARGET'
        ? slot.currency
        : state.sourceCurrency;

      return `
        <div class="card target-card" data-slot-id="${slot.id}">
          <div class="card-header">
            <span class="badge target-badge">Target ${index + 1}</span>
            ${canRemove ? `<button type="button" class="btn-remove-slot" data-action="remove-slot" data-slot-id="${slot.id}" aria-label="Remove target currency">Remove</button>` : ''}
          </div>

          <div class="converter-row">
            <div class="currency-select-wrapper">
              <select class="currency-select target-currency-select" data-slot-id="${slot.id}" aria-label="Target ${index + 1} currency">
                ${buildCurrencyOptionsHtml(slot.currency)}
              </select>
            </div>
            <div class="amount-input-wrapper">
              <input
                type="text"
                inputmode="decimal"
                class="amount-input target-amount-input"
                data-slot-id="${slot.id}"
                placeholder="0"
                value="${formattedAmt}"
                autocomplete="off"
                aria-label="Target ${index + 1} amount in ${slot.currency}"
              />
            </div>
          </div>

          <div class="rate-row">
            <button
              type="button"
              class="rate-direction-btn"
              data-action="toggle-direction"
              data-slot-id="${slot.id}"
              title="Tap to flip exchange rate direction"
            >
              <span>FX Rate: ${dirLabel}</span>
            </button>
            <div class="rate-input-group">
              <input
                type="text"
                inputmode="decimal"
                class="rate-input ${hasValidRate ? '' : 'missing-rate'}"
                data-slot-id="${slot.id}"
                placeholder="Enter rate"
                value="${escapeHtmlAttr(slot.rateInput)}"
                autocomplete="off"
                aria-label="Exchange rate for ${slot.currency}"
              />
              <span class="rate-unit">${unitLabel}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (enabledTargets.length >= 3) {
      addTargetBtn.classList.add('hidden');
    } else {
      addTargetBtn.classList.remove('hidden');
      addTargetBtn.textContent = `+ Add Target Currency (${enabledTargets.length}/3)`;
    }
  }

  function updateCalculatedAmountsInDOM(excludeTargetSlotId = null, updateSourceField = false) {
    if (updateSourceField) {
      sourceAmountInput.value = formatAmount(currentSourceAmount);
    }

    const targetInputs = targetsListEl.querySelectorAll('.target-amount-input');
    targetInputs.forEach(input => {
      const slotId = input.getAttribute('data-slot-id');
      if (slotId === excludeTargetSlotId) return;
      const slot = state.targets.find(t => t.id === slotId);
      if (!slot) return;
      const targetAmt = computeTargetFromSource(currentSourceAmount, slot);
      input.value = formatAmount(targetAmt);
    });
  }

  // --- History Management ---
  function scheduleHistoryCommit() {
    if (historyDebounceTimer) {
      clearTimeout(historyDebounceTimer);
    }
    historyDebounceTimer = setTimeout(() => {
      commitCurrentConversionToHistory();
    }, HISTORY_DEBOUNCE_MS);
  }

  function commitCurrentConversionToHistory() {
    if (historyDebounceTimer) {
      clearTimeout(historyDebounceTimer);
      historyDebounceTimer = null;
    }

    if (currentSourceAmount === null || currentSourceAmount <= 0) {
      return;
    }

    const enabledTargets = state.targets.filter(t => t.enabled);
    const computedTargets = [];

    for (const slot of enabledTargets) {
      const amt = computeTargetFromSource(currentSourceAmount, slot);
      if (amt !== null && amt > 0) {
        computedTargets.push({
          currency: slot.currency,
          amount: Number(amt.toFixed(4)),
          rateDisplay: getRateSummaryText(slot)
        });
      }
    }

    if (computedTargets.length === 0) {
      return;
    }

    const normalizedSourceAmt = Number(currentSourceAmount.toFixed(4));

    // Check against most recent entry to avoid duplicate logs
    const latest = state.history[0];
    if (latest) {
      const sameSource =
        latest.source.currency === state.sourceCurrency &&
        Math.abs(latest.source.amount - normalizedSourceAmt) < 0.0001;
      const sameTargets =
        latest.targets.length === computedTargets.length &&
        latest.targets.every((t, idx) =>
          t.currency === computedTargets[idx].currency &&
          Math.abs(t.amount - computedTargets[idx].amount) < 0.0001
        );
      if (sameSource && sameTargets) {
        return;
      }
    }

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      editedCurrency: lastEditedField.type === 'source'
        ? state.sourceCurrency
        : (state.targets.find(t => t.id === lastEditedField.slotId)?.currency || state.sourceCurrency),
      source: {
        currency: state.sourceCurrency,
        amount: normalizedSourceAmt
      },
      targets: computedTargets
    };

    state.history.unshift(entry);
    if (state.history.length > MAX_HISTORY_ITEMS) {
      state.history = state.history.slice(0, MAX_HISTORY_ITEMS);
    }

    saveState();
    renderHistory();
  }

  function renderHistory() {
    if (!state.history || state.history.length === 0) {
      clearHistoryBtn.classList.add('hidden');
      historyListEl.innerHTML = `
        <div class="history-empty">
          No conversions yet. Enter an amount in any currency above — conversions are saved automatically so you can view them anytime without typing.
        </div>
      `;
      return;
    }

    clearHistoryBtn.classList.remove('hidden');

    historyListEl.innerHTML = state.history.map(item => {
      const timeStr = formatHistoryTimestamp(item.timestamp);
      const sourceDisplay = `${formatDisplayAmountWithCommas(item.source.amount)} ${item.source.currency}`;
      const pillsHtml = item.targets.map(t => `
        <span class="history-pill" title="${escapeHtmlAttr(t.rateDisplay || '')}">
          <span class="history-pill-val">${formatDisplayAmountWithCommas(t.amount)}</span>
          <span class="history-pill-code">${escapeHtmlAttr(t.currency)}</span>
        </span>
      `).join('');

      return `
        <div class="history-item" data-history-id="${escapeHtmlAttr(item.id)}" role="button" tabindex="0" aria-label="Reuse conversion ${escapeHtmlAttr(sourceDisplay)}">
          <div class="history-content">
            <div class="history-main-line">
              <span class="history-source">${escapeHtmlAttr(sourceDisplay)} =</span>
              <span class="history-time">${escapeHtmlAttr(timeStr)}</span>
            </div>
            <div class="history-targets">
              ${pillsHtml}
            </div>
          </div>
          <button
            type="button"
            class="btn-delete-history"
            data-action="delete-history"
            data-history-id="${escapeHtmlAttr(item.id)}"
            title="Delete this entry"
            aria-label="Delete conversion entry"
          >&times;</button>
        </div>
      `;
    }).join('');
  }

  function formatHistoryTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    const timePart = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return timePart;
    const datePart = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${datePart}, ${timePart}`;
  }

  function escapeHtmlAttr(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // --- Live FX Rate Fetching (Public, Free, Keyless, Static CORS Endpoints) ---
  async function fetchLiveRates() {
    const srcLower = state.sourceCurrency.toLowerCase();
    const srcUpper = state.sourceCurrency.toUpperCase();

    const iconSvg = fetchRatesBtn.querySelector('.icon-sync');
    fetchRatesBtn.disabled = true;
    fetchRatesLabel.textContent = 'Fetching...';
    if (iconSvg) iconSvg.classList.add('spinning');

    const endpoints = [
      {
        url: `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${srcLower}.min.json`,
        parse: data => data && data[srcLower] ? data[srcLower] : null
      },
      {
        url: `https://latest.currency-api.pages.dev/v1/currencies/${srcLower}.min.json`,
        parse: data => data && data[srcLower] ? data[srcLower] : null
      },
      {
        url: `https://open.er-api.com/v6/latest/${srcUpper}`,
        parse: data => {
          if (!data || !data.rates) return null;
          const normalized = {};
          for (const [k, v] of Object.entries(data.rates)) {
            normalized[k.toLowerCase()] = v;
          }
          return normalized;
        }
      }
    ];

    let rateMap = null;

    for (const ep of endpoints) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(ep.url, { signal: controller.signal, cache: 'no-store' });
        clearTimeout(timeoutId);
        if (!res.ok) continue;
        const json = await res.json();
        const parsed = ep.parse(json);
        if (parsed && typeof parsed === 'object') {
          rateMap = parsed;
          break;
        }
      } catch {
        // Try next fallback endpoint
      }
    }

    fetchRatesBtn.disabled = false;
    fetchRatesLabel.textContent = 'Fetch Live Rates';
    if (iconSvg) iconSvg.classList.remove('spinning');

    if (!rateMap) {
      renderStatusSubtitle('Could not fetch live rates (offline?) • Using saved rates', 'warn');
      return;
    }

    let updatedCount = 0;
    for (const slot of state.targets) {
      const targetLower = slot.currency.toLowerCase();
      const rawRate = rateMap[targetLower];
      if (typeof rawRate === 'number' && Number.isFinite(rawRate) && rawRate > 0) {
        if (slot.direction === 'SOURCE_TO_TARGET') {
          // 1 Source = rawRate Target
          slot.rateInput = formatRateNumber(rawRate);
        } else {
          // 1 Target = (1 / rawRate) Source
          slot.rateInput = formatRateNumber(1 / rawRate);
        }
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      state.lastFetchedAt = Date.now();
      saveState();
      renderTargets();
      updateCalculatedAmountsInDOM(null, false);
      renderStatusSubtitle('Live rates updated & saved for offline use', 'ok');
    } else {
      renderStatusSubtitle('No matching currency rates found in provider response', 'warn');
    }
  }

  // --- Event Listeners ---
  sourceCurrencySelect.addEventListener('change', e => {
    let selected = e.target.value;
    if (selected === '__CUSTOM__') {
      selected = promptCustomCurrency(state.sourceCurrency);
    }
    state.sourceCurrency = selected;
    saveState();
    renderSourceSelect();
    renderTargets();
    updateCalculatedAmountsInDOM(null, false);
  });

  sourceAmountInput.addEventListener('input', e => {
    const cleaned = sanitizeNumericInput(e.target.value);
    if (e.target.value !== cleaned) {
      e.target.value = cleaned;
    }
    lastEditedField = { type: 'source', slotId: null };
    currentSourceAmount = parsePositiveNumber(cleaned);
    updateCalculatedAmountsInDOM(null, false);
    if (currentSourceAmount !== null) {
      scheduleHistoryCommit();
    }
  });

  sourceAmountInput.addEventListener('blur', () => {
    commitCurrentConversionToHistory();
  });

  sourceAmountInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      commitCurrentConversionToHistory();
      sourceAmountInput.blur();
    }
  });

  clearAmountsBtn.addEventListener('click', () => {
    if (historyDebounceTimer) {
      clearTimeout(historyDebounceTimer);
      historyDebounceTimer = null;
    }
    currentSourceAmount = null;
    sourceAmountInput.value = '';
    updateCalculatedAmountsInDOM(null, false);
    sourceAmountInput.focus();
  });

  // Delegated events for Target cards
  targetsListEl.addEventListener('change', e => {
    const target = e.target;
    if (target.classList.contains('target-currency-select')) {
      const slotId = target.getAttribute('data-slot-id');
      const slot = state.targets.find(t => t.id === slotId);
      if (!slot) return;

      let selected = target.value;
      if (selected === '__CUSTOM__') {
        selected = promptCustomCurrency(slot.currency);
      }
      slot.currency = selected;
      saveState();
      renderSourceSelect();
      renderTargets();
      updateCalculatedAmountsInDOM(null, false);
    }
  });

  targetsListEl.addEventListener('input', e => {
    const target = e.target;
    const slotId = target.getAttribute('data-slot-id');
    const slot = state.targets.find(t => t.id === slotId);
    if (!slot) return;

    if (target.classList.contains('target-amount-input')) {
      const cleaned = sanitizeNumericInput(target.value);
      if (target.value !== cleaned) {
        target.value = cleaned;
      }
      lastEditedField = { type: 'target', slotId };
      const targetAmt = parsePositiveNumber(cleaned);
      if (targetAmt === null) {
        currentSourceAmount = null;
        sourceAmountInput.value = '';
        updateCalculatedAmountsInDOM(slotId, false);
      } else {
        currentSourceAmount = computeSourceFromTarget(targetAmt, slot);
        updateCalculatedAmountsInDOM(slotId, true);
        if (currentSourceAmount !== null) {
          scheduleHistoryCommit();
        }
      }
    } else if (target.classList.contains('rate-input')) {
      const cleaned = sanitizeNumericInput(target.value);
      if (target.value !== cleaned) {
        target.value = cleaned;
      }
      slot.rateInput = cleaned;
      const validRate = parsePositiveNumber(cleaned) !== null;
      target.classList.toggle('missing-rate', !validRate);
      saveState();
      renderStatusSubtitle();
      updateCalculatedAmountsInDOM(null, false);
    }
  });

  targetsListEl.addEventListener('focusout', e => {
    if (e.target.classList.contains('target-amount-input')) {
      commitCurrentConversionToHistory();
    }
  });

  targetsListEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.target.classList.contains('target-amount-input') || e.target.classList.contains('rate-input'))) {
      commitCurrentConversionToHistory();
      e.target.blur();
    }
  });

  targetsListEl.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const slotId = btn.getAttribute('data-slot-id');
    const slot = state.targets.find(t => t.id === slotId);
    if (!slot) return;

    if (action === 'toggle-direction') {
      slot.direction = slot.direction === 'SOURCE_TO_TARGET'
        ? 'TARGET_TO_SOURCE'
        : 'SOURCE_TO_TARGET';

      // Invert existing valid numeric rate so the pair's exchange value stays consistent
      const existingRate = parsePositiveNumber(slot.rateInput);
      if (existingRate !== null) {
        slot.rateInput = formatRateNumber(1 / existingRate);
      }

      saveState();
      renderTargets();
      updateCalculatedAmountsInDOM(null, false);
    } else if (action === 'remove-slot') {
      const enabledCount = state.targets.filter(t => t.enabled).length;
      if (enabledCount <= 1) return;
      slot.enabled = false;
      saveState();
      renderTargets();
    }
  });

  addTargetBtn.addEventListener('click', () => {
    const disabledSlot = state.targets.find(t => !t.enabled);
    if (!disabledSlot) return;
    disabledSlot.enabled = true;
    saveState();
    renderTargets();
    updateCalculatedAmountsInDOM(null, false);
  });

  fetchRatesBtn.addEventListener('click', () => {
    fetchLiveRates();
  });

  // History actions (tap to restore or delete)
  historyListEl.addEventListener('click', e => {
    const deleteBtn = e.target.closest('button[data-action="delete-history"]');
    if (deleteBtn) {
      e.stopPropagation();
      const id = deleteBtn.getAttribute('data-history-id');
      state.history = state.history.filter(item => item.id !== id);
      saveState();
      renderHistory();
      return;
    }

    const itemEl = e.target.closest('.history-item');
    if (!itemEl) return;
    const id = itemEl.getAttribute('data-history-id');
    const entry = state.history.find(item => item.id === id);
    if (!entry) return;

    // Restore source currency & amount if needed
    if (entry.source && entry.source.amount > 0) {
      if (entry.source.currency && entry.source.currency !== state.sourceCurrency) {
        state.sourceCurrency = entry.source.currency;
        saveState();
        renderSourceSelect();
        renderTargets();
      }
      currentSourceAmount = entry.source.amount;
      sourceAmountInput.value = formatAmount(currentSourceAmount);
      updateCalculatedAmountsInDOM(null, false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  clearHistoryBtn.addEventListener('click', () => {
    state.history = [];
    saveState();
    renderHistory();
  });

  // --- PWA Install Prompt & Service Worker ---
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    installBtn.classList.remove('hidden');
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBtn.classList.add('hidden');
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installBtn.classList.add('hidden');
  });

  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const shareData = {
        title: 'Travel FX Converter',
        text: 'Simple offline-ready travel currency converter with saved FX rates & conversion history.',
        url: window.location.href
      };
      if (navigator.share) {
        try {
          await navigator.share(shareData);
          return;
        } catch {
          // User cancelled native share sheet
          return;
        }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(window.location.href);
          renderStatusSubtitle('Link copied to clipboard!', 'ok');
          setTimeout(() => renderStatusSubtitle(), 2500);
        } catch {
          // Ignore clipboard error
        }
      }
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // Service worker registration may be skipped on file:// protocol
      });
    });
  }

  // --- Initial Render ---
  renderStatusSubtitle();
  renderSourceSelect();
  renderTargets();
  renderHistory();
})();
