/* ============================================================
   COFFRETTE — Cash Manager · app.js
   Coffrettes dynamiques : ajout / renommage / suppression
   income → +coffrette / expense → −coffrette
   ============================================================ */

'use strict';

/* ── STORAGE ──────────────────────────────────────────────── */
const Storage = (() => {
  const KEY = 'coffrette_v2';

  /**
   * Données par défaut :
   * vaults : tableau de { id, name, emoji, balance }
   * operations : tableau de { id, type, vaultId, amount, note, date }
   */
  const defaultState = () => ({
    vaults: [
      { id: 'paris', name: 'Paris', emoji: '🗼', balance: 0 },
      { id: 'ivry',  name: 'Ivry',  emoji: '🏢', balance: 0 },
    ],
    operations: [],
  });

  let state = defaultState();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Migration : ancienne structure avec vaults objet → nouveau format tableau
        if (parsed.vaults && !Array.isArray(parsed.vaults)) {
          parsed.vaults = [
            { id: 'paris', name: 'Paris', emoji: '🗼', balance: parsed.vaults.paris ?? 0 },
            { id: 'ivry',  name: 'Ivry',  emoji: '🏢', balance: parsed.vaults.ivry  ?? 0 },
          ];
          // Migrer vaultId dans les opérations (vault → vaultId)
          parsed.operations = (parsed.operations || []).map(op => ({
            ...op,
            vaultId: op.vaultId ?? op.vault ?? 'paris',
          }));
        }
        state = parsed;
      }
    } catch {
      state = defaultState();
    }
    return state;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.warn('Sauvegarde impossible :', e); }
  }

  function getState()  { return state; }
  function setState(s) { state = s; save(); }

  return { load, save, getState, setState };
})();

/* ── DATE HELPERS ─────────────────────────────────────────── */
const DateHelpers = (() => {
  const parse        = (str) => { const [y,m,d] = str.split('-').map(Number); return new Date(y, m-1, d); };
  const toISO        = (d)   => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const toMonthKey   = (iso) => iso.slice(0, 7);
  const today        = ()    => toISO(new Date());
  const toShortLabel = (iso) => parse(iso).toLocaleDateString('fr-FR', { day:'numeric', month:'short' });
  return { parse, toISO, toMonthKey, today, toShortLabel };
})();

/* ── CURRENCY ─────────────────────────────────────────────── */
const Currency = (() => {
  const fmt = new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  });
  return { format: (n) => fmt.format(n) };
})();

/* ── VAULTS ───────────────────────────────────────────────── */
const Vaults = (() => {
  const genId = () => 'v_' + Date.now().toString(36);

  function getAll()      { return Storage.getState().vaults; }
  function getById(id)   { return getAll().find(v => v.id === id); }

  function add({ name, emoji }) {
    const state = Storage.getState();
    const vault = { id: genId(), name: name.trim(), emoji: emoji || '🏦', balance: 0 };
    state.vaults.push(vault);
    Storage.setState(state);
    return vault;
  }

  function rename(id, { name, emoji }) {
    const state = Storage.getState();
    const v = state.vaults.find(v => v.id === id);
    if (!v) return;
    v.name  = name.trim();
    v.emoji = emoji || v.emoji;
    Storage.setState(state);
  }

  function remove(id) {
    const state = Storage.getState();
    // Supprimer la coffrette et toutes ses opérations
    state.vaults     = state.vaults.filter(v => v.id !== id);
    state.operations = state.operations.filter(o => o.vaultId !== id);
    Storage.setState(state);
  }

  return { getAll, getById, add, rename, remove };
})();

/* ── OPERATIONS ───────────────────────────────────────────── */
const Operations = (() => {
  const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function _apply(state, op) {
    const v = state.vaults.find(v => v.id === op.vaultId);
    if (!v) return;
    if (op.type === 'income')  v.balance = +(v.balance + op.amount).toFixed(2);
    if (op.type === 'expense') v.balance = +(v.balance - op.amount).toFixed(2);
  }

  function _revert(state, op) {
    const v = state.vaults.find(v => v.id === op.vaultId);
    if (!v) return;
    if (op.type === 'income')  v.balance = +(v.balance - op.amount).toFixed(2);
    if (op.type === 'expense') v.balance = +(v.balance + op.amount).toFixed(2);
  }

  function add({ type, vaultId, amount, note, date }) {
    const state = Storage.getState();
    const op = { id: genId(), type, vaultId, amount, note: note || '', date };
    _apply(state, op);
    state.operations.unshift(op);
    Storage.setState(state);
    return op;
  }

  function update(id, changes) {
    const state = Storage.getState();
    const idx = state.operations.findIndex(o => o.id === id);
    if (idx === -1) return;
    const old = state.operations[idx];
    _revert(state, old);
    const updated = { ...old, ...changes };
    state.operations[idx] = updated;
    _apply(state, updated);
    Storage.setState(state);
    return updated;
  }

  function remove(id) {
    const state = Storage.getState();
    const op = state.operations.find(o => o.id === id);
    if (!op) return;
    _revert(state, op);
    state.operations = state.operations.filter(o => o.id !== id);
    Storage.setState(state);
  }

  function currentMonth() {
    const key = DateHelpers.toMonthKey(DateHelpers.today());
    return Storage.getState().operations.filter(o => DateHelpers.toMonthKey(o.date) === key);
  }

  function monthlyExpenses() {
    return currentMonth().filter(o => o.type === 'expense').reduce((s,o) => s + o.amount, 0);
  }

  function monthlyIncomes() {
    return currentMonth().filter(o => o.type === 'income').reduce((s,o) => s + o.amount, 0);
  }

  /** Bilan d'un mois donné (clé "YYYY-MM") */
  function bilanForMonth(monthKey) {
    const ops = Storage.getState().operations.filter(o => DateHelpers.toMonthKey(o.date) === monthKey);
    const inc = ops.filter(o => o.type === 'income').reduce((s,o) => s + o.amount, 0);
    const exp = ops.filter(o => o.type === 'expense').reduce((s,o) => s + o.amount, 0);
    return +(inc - exp).toFixed(2);
  }

  /**
   * Enregistre le bilan du mois précédent dans monthlySnapshots si pas encore fait.
   * Appelé automatiquement au démarrage.
   */
  function snapshotPreviousMonth() {
    const state = Storage.getState();
    if (!state.monthlySnapshots) state.monthlySnapshots = {};

    const today    = new Date();
    const prevDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevKey  = DateHelpers.toMonthKey(DateHelpers.toISO(prevDate));

    if (!state.monthlySnapshots[prevKey]) {
      const bilan = bilanForMonth(prevKey);
      // N'enregistre que si le mois précédent a des opérations
      const hasOps = state.operations.some(o => DateHelpers.toMonthKey(o.date) === prevKey);
      if (hasOps) {
        state.monthlySnapshots[prevKey] = bilan;
        Storage.setState(state);
      }
    }
  }

  function getSnapshots() {
    return Storage.getState().monthlySnapshots || {};
  }

  return { add, update, remove, currentMonth, monthlyExpenses, monthlyIncomes, bilanForMonth, snapshotPreviousMonth, getSnapshots };
})();

/* ── UI HELPERS ───────────────────────────────────────────── */
const UI = (() => {
  const typeLabel   = { income: 'Rentrée', expense: 'Dépense' };
  const pipClass    = (type) => type === 'income' ? 'op-pip--income' : 'op-pip--expense';
  const amountClass = (type) => type === 'income' ? 'op-amount--pos' : 'op-amount--neg';
  const amountSign  = (type) => type === 'income' ? '+' : '−';

  function vaultLabel(vaultId) {
    const v = Vaults.getById(vaultId);
    return v ? `${v.emoji} ${v.name}` : vaultId;
  }

  function createOpItem(op, opts = {}) {
    const el = document.createElement('div');
    el.className = 'op-item';
    el.dataset.id = op.id;
    el.innerHTML = `
      <span class="op-pip ${pipClass(op.type)}"></span>
      <div class="op-info">
        <span class="op-note">${op.note || typeLabel[op.type]}</span>
        <span class="op-meta">${DateHelpers.toShortLabel(op.date)} · ${typeLabel[op.type]} · ${vaultLabel(op.vaultId)}</span>
      </div>
      <span class="op-amount ${amountClass(op.type)}">
        ${amountSign(op.type)}${Currency.format(op.amount)}
      </span>
      <div class="op-actions">
        ${opts.showEdit !== false ? `
          <button class="op-btn op-btn--edit" data-action="edit" data-id="${op.id}" aria-label="Modifier">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>` : ''}
        ${opts.showDelete !== false ? `
          <button class="op-btn op-btn--delete" data-action="delete" data-id="${op.id}" aria-label="Supprimer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>` : ''}
      </div>
    `;
    return el;
  }

  function renderOpList(container, ops, emptyText = 'Aucune opération', opts = {}) {
    container.innerHTML = '';
    if (!ops.length) { container.innerHTML = `<p class="empty-state">${emptyText}</p>`; return; }
    ops.forEach(op => container.appendChild(createOpItem(op, opts)));
  }

  let _toastTimer;
  function toast(msg) {
    document.querySelector('.toast')?.remove();
    clearTimeout(_toastTimer);
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    _toastTimer = setTimeout(() => {
      el.classList.add('toast--out');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }, 2400);
  }

  return { createOpItem, renderOpList, toast, typeLabel, vaultLabel };
})();

/* ── ROUTER ───────────────────────────────────────────────── */
const Router = (() => {
  const views = {
    home:         document.getElementById('viewHome'),
    vault:        document.getElementById('viewVault'),
    expenses:     document.getElementById('viewExpenses'),
    incomes:      document.getElementById('viewIncomes'),
    history:      document.getElementById('viewHistory'),
    manageVaults: document.getElementById('viewManageVaults'),
  };
  const btnBack     = document.getElementById('btnBack');
  const btnHistory  = document.getElementById('btnHistory');
  const headerTitle = document.getElementById('headerTitle');

  let current      = 'home';
  let vaultContext = null;

  const titles = {
    home: 'Coffrette', vault: '', expenses: 'Dépenses',
    incomes: 'Rentrées', history: 'Historique', manageVaults: 'Mes coffrettes',
  };

  function navigate(viewId, params = {}) {
    views[current]?.classList.remove('active');
    current      = viewId;
    vaultContext = params.vaultId || null;

    views[viewId].classList.add('active');
    views[viewId].scrollTop = 0;

    const isHome = viewId === 'home';
    btnBack.classList.toggle('hidden', isHome);
    btnHistory.classList.toggle('hidden', !isHome);

    if (viewId === 'vault' && params.vaultId) {
      const v = Vaults.getById(params.vaultId);
      headerTitle.textContent = v ? `${v.emoji} ${v.name}` : 'Coffrette';
    } else {
      headerTitle.textContent = titles[viewId] || 'Coffrette';
    }

    Render[viewId]?.(params);
  }

  btnBack.addEventListener('click', () => navigate('home'));
  btnHistory.addEventListener('click', () => navigate('history'));

  function getVaultContext() { return vaultContext; }

  return { navigate, getVaultContext };
})();

/* ── MODAL OPÉRATION ──────────────────────────────────────── */
const Modal = (() => {
  const overlay     = document.getElementById('modalOverlay');
  const btnClose    = document.getElementById('modalClose');
  const btnSubmit   = document.getElementById('btnSubmit');
  const modalTitle  = document.getElementById('modalTitle');
  const formError   = document.getElementById('formError');
  const inputAmount = document.getElementById('inputAmount');
  const inputNote   = document.getElementById('inputNote');
  const inputDate   = document.getElementById('inputDate');
  const typeBtns    = document.querySelectorAll('.type-btn');
  const vaultRow    = document.getElementById('vaultSelectRow');

  let editId        = null;
  let selectedType  = null;
  let selectedVault = null;

  function buildVaultButtons() {
    vaultRow.innerHTML = '';
    Vaults.getAll().forEach(v => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vault-btn' + (v.id === selectedVault ? ' active' : '');
      btn.dataset.vault = v.id;
      btn.textContent = `${v.emoji} ${v.name}`;
      btn.addEventListener('click', () => selectVault(v.id));
      vaultRow.appendChild(btn);
    });
  }

  function selectType(type) {
    selectedType = type;
    typeBtns.forEach(b => b.classList.toggle('active', b.dataset.type === type));
  }

  function selectVault(id) {
    selectedVault = id;
    vaultRow.querySelectorAll('.vault-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.vault === id)
    );
  }

  typeBtns.forEach(b => b.addEventListener('click', () => selectType(b.dataset.type)));

  function open(prefill = {}) {
    editId = prefill.id || null;
    modalTitle.textContent = editId ? "Modifier l'opération" : 'Nouvelle opération';
    btnSubmit.textContent  = editId ? 'Enregistrer les modifications' : 'Enregistrer';

    selectedType  = null;
    selectedVault = prefill.vaultId || null;
    typeBtns.forEach(b => b.classList.remove('active'));
    inputAmount.value = '';
    inputNote.value   = '';
    inputDate.value   = DateHelpers.today();
    formError.classList.add('hidden');

    buildVaultButtons();

    if (prefill.type)    selectType(prefill.type);
    if (prefill.vaultId) selectVault(prefill.vaultId);
    if (prefill.amount)  inputAmount.value = prefill.amount;
    if (prefill.note)    inputNote.value   = prefill.note;
    if (prefill.date)    inputDate.value   = prefill.date;

    overlay.classList.remove('hidden');
    requestAnimationFrame(() => inputAmount.focus());
  }

  function close() { overlay.classList.add('hidden'); editId = null; }

  function showError(msg) { formError.textContent = msg; formError.classList.remove('hidden'); }

  btnClose.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  btnSubmit.addEventListener('click', () => {
    formError.classList.add('hidden');
    if (!selectedType)  return showError("Sélectionne un type d'opération.");
    if (!selectedVault) return showError('Sélectionne une coffrette.');
    const raw = parseFloat(inputAmount.value.replace(',', '.'));
    if (!raw || raw <= 0) return showError('Montant invalide.');

    const payload = {
      type: selectedType, vaultId: selectedVault,
      amount: raw, note: inputNote.value.trim(),
      date: inputDate.value || DateHelpers.today(),
    };

    if (editId) {
      Operations.update(editId, payload);
      UI.toast('Opération modifiée ✓');
    } else {
      Operations.add(payload);
      UI.toast('Opération ajoutée ✓');
    }

    close();
    Render.home();
    const ctx = Router.getVaultContext();
    if (ctx) Render.vault({ vaultId: ctx });
  });

  [inputAmount, inputNote, inputDate].forEach(el =>
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnSubmit.click(); })
  );

  return { open, close };
})();

/* ── MODAL COFFRETTE (ajout / renommage) ──────────────────── */
const VaultModal = (() => {
  const overlay    = document.getElementById('vaultModalOverlay');
  const titleEl    = document.getElementById('vaultModalTitle');
  const btnClose   = document.getElementById('vaultModalClose');
  const btnSubmit  = document.getElementById('vaultModalSubmit');
  const inputEmoji = document.getElementById('vaultInputEmoji');
  const inputName  = document.getElementById('vaultInputName');
  const errorEl    = document.getElementById('vaultFormError');

  let editId = null;

  function open(vault = null) {
    editId = vault?.id || null;
    titleEl.textContent    = editId ? 'Modifier la coffrette' : 'Nouvelle coffrette';
    btnSubmit.textContent  = editId ? 'Enregistrer' : 'Ajouter';
    inputEmoji.value = vault?.emoji || '';
    inputName.value  = vault?.name  || '';
    errorEl.classList.add('hidden');
    overlay.classList.remove('hidden');
    requestAnimationFrame(() => inputName.focus());
  }

  function close() { overlay.classList.add('hidden'); editId = null; }

  function showError(msg) { errorEl.textContent = msg; errorEl.classList.remove('hidden'); }

  btnClose.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  btnSubmit.addEventListener('click', () => {
    errorEl.classList.add('hidden');
    const name  = inputName.value.trim();
    const emoji = inputEmoji.value.trim() || '🏦';
    if (!name) return showError('Donne un nom à la coffrette.');

    if (editId) {
      Vaults.rename(editId, { name, emoji });
      UI.toast('Coffrette modifiée ✓');
    } else {
      Vaults.add({ name, emoji });
      UI.toast('Coffrette ajoutée ✓');
    }

    close();
    Render.home();
    Render.manageVaults();
  });

  inputName.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnSubmit.click(); });

  return { open, close };
})();

/* ── CONFIRM ──────────────────────────────────────────────── */
const Confirm = (() => {
  const overlay    = document.getElementById('confirmOverlay');
  const textEl     = document.getElementById('confirmText');
  const btnCancel  = document.getElementById('btnCancelDelete');
  const btnConfirm = document.getElementById('btnConfirmDelete');
  let _cb = null;

  function ask(msg, cb) {
    textEl.textContent = msg;
    _cb = cb;
    overlay.classList.remove('hidden');
  }

  function close() { overlay.classList.add('hidden'); _cb = null; }

  btnCancel.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  btnConfirm.addEventListener('click', () => { _cb?.(); close(); });

  return { ask };
})();

/* ── RENDER ───────────────────────────────────────────────── */
const Render = (() => {

  function home() {
    const vaults = Vaults.getAll();
    const total  = vaults.reduce((s, v) => s + v.balance, 0);

    document.getElementById('totalAmount').textContent = Currency.format(total);

    const sub = document.getElementById('totalSub');
    sub.innerHTML = vaults.map((v, i) =>
      `${i > 0 ? '<span class="total-sep">·</span>' : ''}<span>${v.emoji} ${v.name} ${Currency.format(v.balance)}</span>`
    ).join('');

    // Cartes coffrettes
    const container = document.getElementById('vaultCards');
    container.innerHTML = '';
    vaults.forEach(v => {
      const card = document.createElement('div');
      card.className = 'card card--vault';
      card.dataset.action  = 'open-vault';
      card.dataset.vaultId = v.id;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.innerHTML = `
        <div class="card-top">
          <span class="vault-emoji">${v.emoji}</span>
          <svg class="card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        </div>
        <span class="card-name">${v.name}</span>
        <span class="card-amount">${Currency.format(v.balance)}</span>
      `;
      container.appendChild(card);
    });

    // Stats mois
    const exp = Operations.monthlyExpenses();
    const inc = Operations.monthlyIncomes();
    const bilan = +(inc - exp).toFixed(2);

    document.getElementById('amountExpenses').textContent = Currency.format(exp);
    document.getElementById('amountIncomes').textContent  = Currency.format(inc);

    // Bilan card
    const bilanAmountEl = document.getElementById('bilanAmount');
    const bilanBadgeEl  = document.getElementById('bilanBadge');
    const bilanSubEl    = document.getElementById('bilanSub');

    bilanAmountEl.textContent = (bilan > 0 ? '+' : '') + Currency.format(bilan);
    bilanSubEl.textContent    = `+${Currency.format(inc)} − ${Currency.format(exp)}`;

    bilanAmountEl.className = 'bilan-amount ' + (bilan > 0 ? 'bilan-amount--pos' : bilan < 0 ? 'bilan-amount--neg' : 'bilan-amount--zero');
    bilanBadgeEl.className  = 'bilan-badge '  + (bilan > 0 ? 'bilan-badge--pos'  : bilan < 0 ? 'bilan-badge--neg'  : 'bilan-badge--zero');
    bilanBadgeEl.textContent = bilan > 0 ? 'Bénéfice' : bilan < 0 ? 'Déficit' : 'Équilibre';

    // Récent
    const recent = Storage.getState().operations.slice(0, 5);
    UI.renderOpList(document.getElementById('recentList'), recent, "Aucune opération pour l'instant");
  }

  function vault({ vaultId }) {
    const v = Vaults.getById(vaultId);
    if (!v) return;
    document.getElementById('vaultHeroLabel').textContent  = `${v.emoji} ${v.name}`;
    document.getElementById('vaultHeroAmount').textContent = Currency.format(v.balance);

    const ops = Storage.getState().operations.filter(o => o.vaultId === vaultId);
    UI.renderOpList(document.getElementById('vaultOpsList'), ops, 'Aucune opération sur cette coffrette');
  }

  function expenses() {
    const ops = Operations.currentMonth().filter(o => o.type === 'expense');
    document.getElementById('expensesHeroAmount').textContent = Currency.format(Operations.monthlyExpenses());
    UI.renderOpList(document.getElementById('expensesOpsList'), ops, 'Aucune dépense ce mois-ci');
  }

  function incomes() {
    const ops = Operations.currentMonth().filter(o => o.type === 'income');
    document.getElementById('incomesHeroAmount').textContent = Currency.format(Operations.monthlyIncomes());
    UI.renderOpList(document.getElementById('incomesOpsList'), ops, 'Aucune rentrée ce mois-ci');
  }

  function history() {
    const { operations } = Storage.getState();
    const snapshots      = Operations.getSnapshots();
    const filterSelect   = document.getElementById('filterMonth');
    const container      = document.getElementById('historyContent');

    const months = [...new Set(operations.map(o => DateHelpers.toMonthKey(o.date)))].sort().reverse();
    const cur = filterSelect.value;
    filterSelect.innerHTML = '<option value="all">Tous les mois</option>';
    months.forEach(mk => {
      const [y, m] = mk.split('-').map(Number);
      const label  = new Date(y, m-1, 1).toLocaleDateString('fr-FR', { month:'long', year:'numeric' });
      const opt    = document.createElement('option');
      opt.value = mk;
      opt.textContent = label.charAt(0).toUpperCase() + label.slice(1);
      filterSelect.appendChild(opt);
    });
    if (cur && cur !== 'all') filterSelect.value = cur;

    const filter   = filterSelect.value;
    const filtered = filter === 'all' ? operations
      : operations.filter(o => DateHelpers.toMonthKey(o.date) === filter);

    if (!filtered.length) { container.innerHTML = '<p class="empty-state">Aucune opération</p>'; return; }

    const groups = {};
    filtered.forEach(op => { const mk = DateHelpers.toMonthKey(op.date); (groups[mk] = groups[mk] || []).push(op); });

    container.innerHTML = '';
    Object.entries(groups).sort(([a],[b]) => b.localeCompare(a)).forEach(([mk, ops]) => {
      const [y, m] = mk.split('-').map(Number);
      const monthName = new Date(y, m-1, 1).toLocaleDateString('fr-FR', { month:'long', year:'numeric' });
      const totalIn   = ops.filter(o => o.type === 'income').reduce((s,o) => s + o.amount, 0);
      const totalOut  = ops.filter(o => o.type === 'expense').reduce((s,o) => s + o.amount, 0);

      // Bilan : snapshot enregistré OU calculé à la volée pour le mois courant
      const currentKey = DateHelpers.toMonthKey(DateHelpers.today());
      const bilan = mk in snapshots ? snapshots[mk] : Operations.bilanForMonth(mk);
      const bilanClass  = bilan > 0 ? 'bilan-amount--pos' : bilan < 0 ? 'bilan-amount--neg' : 'bilan-amount--zero';
      const bilanLabel  = bilan > 0 ? 'Bénéfice' : bilan < 0 ? 'Déficit' : 'Équilibre';
      const bilanSign   = bilan > 0 ? '+' : '';
      const isCurrent   = mk === currentKey;

      const group = document.createElement('div');
      group.className = 'history-month';
      group.innerHTML = `
        <div class="month-header">
          <span class="month-title">${monthName.charAt(0).toUpperCase() + monthName.slice(1)}${isCurrent ? ' <span style="font-size:10px;color:var(--gold);font-weight:600;letter-spacing:.08em">EN COURS</span>' : ''}</span>
          <div class="month-stats">
            ${totalIn  ? `<span class="month-stat month-stat--in">+${Currency.format(totalIn)}</span>`  : ''}
            ${totalOut ? `<span class="month-stat month-stat--out">−${Currency.format(totalOut)}</span>` : ''}
          </div>
        </div>
        <div class="month-bilan">
          <span class="month-bilan-label">Bilan · ${bilanLabel}</span>
          <span class="month-bilan-amount ${bilanClass}">${bilanSign}${Currency.format(bilan)}</span>
        </div>`;

      const list = document.createElement('div');
      list.className = 'ops-list';
      ops.forEach(op => list.appendChild(UI.createOpItem(op, { showEdit: true, showDelete: true })));
      group.appendChild(list);
      container.appendChild(group);
    });
  }

  function manageVaults() {
    const container = document.getElementById('manageVaultList');
    container.innerHTML = '';
    const vaults = Vaults.getAll();

    if (!vaults.length) {
      container.innerHTML = '<p class="empty-state">Aucune coffrette</p>';
      return;
    }

    vaults.forEach(v => {
      const item = document.createElement('div');
      item.className = 'vault-manage-item';
      item.innerHTML = `
        <span class="vault-manage-emoji">${v.emoji}</span>
        <div class="vault-manage-info">
          <div class="vault-manage-name">${v.name}</div>
          <div class="vault-manage-amount">${Currency.format(v.balance)}</div>
        </div>
        <div class="vault-manage-actions">
          <button class="op-btn op-btn--edit" data-action="rename-vault" data-id="${v.id}" aria-label="Modifier">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="op-btn op-btn--delete" data-action="delete-vault" data-id="${v.id}" aria-label="Supprimer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      `;
      container.appendChild(item);
    });
  }

  return { home, vault, expenses, incomes, history, manageVaults };
})();

/* ── EVENT DELEGATION ─────────────────────────────────────── */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;

  const { action } = el.dataset;

  if (action === 'open-vault')   return Router.navigate('vault', { vaultId: el.dataset.vaultId });
  if (action === 'open-detail')  return Router.navigate(el.dataset.detail);

  if (action === 'edit') {
    const op = Storage.getState().operations.find(o => o.id === el.dataset.id);
    if (op) Modal.open({ ...op });
    return;
  }

  if (action === 'delete') {
    Confirm.ask('Supprimer cette opération ? Cette action est irréversible.', () => {
      Operations.remove(el.dataset.id);
      UI.toast('Opération supprimée');
      Render.home();
      const ctx = Router.getVaultContext();
      if (ctx) Render.vault({ vaultId: ctx });
      else Render.history();
    });
    return;
  }

  if (action === 'rename-vault') {
    const v = Vaults.getById(el.dataset.id);
    if (v) VaultModal.open(v);
    return;
  }

  if (action === 'delete-vault') {
    const v = Vaults.getById(el.dataset.id);
    if (!v) return;
    const ops = Storage.getState().operations.filter(o => o.vaultId === v.id);
    const msg = ops.length
      ? `Supprimer "${v.name}" et ses ${ops.length} opération(s) ? Cette action est irréversible.`
      : `Supprimer la coffrette "${v.name}" ? Cette action est irréversible.`;
    Confirm.ask(msg, () => {
      Vaults.remove(v.id);
      UI.toast(`Coffrette "${v.name}" supprimée`);
      Render.home();
      Render.manageVaults();
    });
    return;
  }
});

document.getElementById('fab').addEventListener('click', () => Modal.open());
document.getElementById('btnSeeAll').addEventListener('click', () => Router.navigate('history'));
document.getElementById('btnManageVaults').addEventListener('click', () => Router.navigate('manageVaults'));
document.getElementById('btnAddVault').addEventListener('click', () => VaultModal.open());
document.getElementById('filterMonth').addEventListener('change', () => Render.history());

/* ── INIT ─────────────────────────────────────────────────── */
(function init() {
  Storage.load();
  Operations.snapshotPreviousMonth(); // enregistre le bilan du mois précédent si besoin
  Render.home();
})();