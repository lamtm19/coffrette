/* ============================================================
   Coffrette — Cash Manager · app.js
   Logique : income → +coffrette / expense → −coffrette
   ============================================================ */

'use strict';

/* ── STORAGE ──────────────────────────────────────────────── */
const Storage = (() => {
  const KEY = 'Coffrette_v1';

  const defaultState = () => ({
    vaults: { paris: 0, ivry: 0 },
    operations: [],
  });

  let state = defaultState();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) state = JSON.parse(raw);
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
  const parse      = (str) => { const [y,m,d] = str.split('-').map(Number); return new Date(y, m-1, d); };
  const toISO      = (d)   => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const toMonthKey = (iso) => iso.slice(0, 7);
  const today      = ()    => toISO(new Date());
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

/* ── OPERATIONS ───────────────────────────────────────────── */
/**
 * Structure Operation :
 * { id, type: 'income'|'expense', vault: 'paris'|'ivry', amount, note, date }
 *
 * Règle :  income  → vault += amount
 *          expense → vault -= amount
 * Les deux types impactent TOUJOURS la coffrette sélectionnée.
 */
const Operations = (() => {
  const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /** Applique l'effet d'une op sur les coffrettes */
  function _apply(state, op) {
    if (op.type === 'income')  state.vaults[op.vault] = +(state.vaults[op.vault] + op.amount).toFixed(2);
    if (op.type === 'expense') state.vaults[op.vault] = +(state.vaults[op.vault] - op.amount).toFixed(2);
  }

  /** Annule l'effet d'une op sur les coffrettes */
  function _revert(state, op) {
    if (op.type === 'income')  state.vaults[op.vault] = +(state.vaults[op.vault] - op.amount).toFixed(2);
    if (op.type === 'expense') state.vaults[op.vault] = +(state.vaults[op.vault] + op.amount).toFixed(2);
  }

  function add({ type, vault, amount, note, date }) {
    const state = Storage.getState();
    const op = { id: genId(), type, vault, amount, note: note || '', date };
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
    return currentMonth().filter(o => o.type === 'expense').reduce((s, o) => s + o.amount, 0);
  }

  function monthlyIncomes() {
    return currentMonth().filter(o => o.type === 'income').reduce((s, o) => s + o.amount, 0);
  }

  return { add, update, remove, currentMonth, monthlyExpenses, monthlyIncomes };
})();

/* ── UI HELPERS ───────────────────────────────────────────── */
const UI = (() => {
  const typeLabel  = { income: 'Rentrée', expense: 'Dépense' };
  const vaultLabel = { paris: '🗼 Paris', ivry: '🏢 Ivry' };

  const pipClass    = (type) => type === 'income' ? 'op-pip--income' : 'op-pip--expense';
  const amountClass = (type) => type === 'income' ? 'op-amount--pos' : 'op-amount--neg';
  const amountSign  = (type) => type === 'income' ? '+' : '−';

  function createOpItem(op, opts = {}) {
    const el = document.createElement('div');
    el.className = 'op-item';
    el.dataset.id = op.id;

    el.innerHTML = `
      <span class="op-pip ${pipClass(op.type)}"></span>
      <div class="op-info">
        <span class="op-note">${op.note || typeLabel[op.type]}</span>
        <span class="op-meta">${DateHelpers.toShortLabel(op.date)} · ${typeLabel[op.type]} · ${vaultLabel[op.vault]}</span>
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
    if (!ops.length) {
      container.innerHTML = `<p class="empty-state">${emptyText}</p>`;
      return;
    }
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
    home:     document.getElementById('viewHome'),
    vault:    document.getElementById('viewVault'),
    expenses: document.getElementById('viewExpenses'),
    incomes:  document.getElementById('viewIncomes'),
    history:  document.getElementById('viewHistory'),
  };
  const btnBack     = document.getElementById('btnBack');
  const btnHistory  = document.getElementById('btnHistory');
  const headerTitle = document.getElementById('headerTitle');

  let current      = 'home';
  let vaultContext = null;

  const titles = { home: 'Coffrette', vault: '', expenses: 'Dépenses', incomes: 'Rentrées', history: 'Historique' };

  function navigate(viewId, params = {}) {
    views[current]?.classList.remove('active');
    current      = viewId;
    vaultContext = params.vault || null;

    views[viewId].classList.add('active');
    views[viewId].scrollTop = 0;

    const isHome = viewId === 'home';
    btnBack.classList.toggle('hidden', isHome);
    btnHistory.classList.toggle('hidden', !isHome);

    headerTitle.textContent = viewId === 'vault' && params.vault
      ? (params.vault === 'paris' ? '🗼 Paris' : '🏢 Ivry')
      : titles[viewId] || 'Coffrette';

    Render[viewId]?.(params);
  }

  btnBack.addEventListener('click', () => navigate('home'));
  btnHistory.addEventListener('click', () => navigate('history'));

  function getVaultContext() { return vaultContext; }

  return { navigate, getVaultContext };
})();

/* ── MODAL ────────────────────────────────────────────────── */
const Modal = (() => {
  const overlay    = document.getElementById('modalOverlay');
  const btnClose   = document.getElementById('modalClose');
  const btnSubmit  = document.getElementById('btnSubmit');
  const modalTitle = document.getElementById('modalTitle');
  const formError  = document.getElementById('formError');
  const inputAmount = document.getElementById('inputAmount');
  const inputNote   = document.getElementById('inputNote');
  const inputDate   = document.getElementById('inputDate');
  const typeBtns    = document.querySelectorAll('.type-btn');
  const vaultBtns   = document.querySelectorAll('.vault-btn');

  let editId        = null;
  let selectedType  = null;
  let selectedVault = null;

  function selectType(type) {
    selectedType = type;
    typeBtns.forEach(b => b.classList.toggle('active', b.dataset.type === type));
  }

  function selectVault(vault) {
    selectedVault = vault;
    vaultBtns.forEach(b => b.classList.toggle('active', b.dataset.vault === vault));
  }

  typeBtns.forEach(b => b.addEventListener('click', () => selectType(b.dataset.type)));
  vaultBtns.forEach(b => b.addEventListener('click', () => selectVault(b.dataset.vault)));

  function open(prefill = {}) {
    editId = prefill.id || null;
    modalTitle.textContent  = editId ? "Modifier l'opération" : 'Nouvelle opération';
    btnSubmit.textContent   = editId ? 'Enregistrer les modifications' : 'Enregistrer';

    // Reset
    selectedType = null; selectedVault = null;
    typeBtns.forEach(b => b.classList.remove('active'));
    vaultBtns.forEach(b => b.classList.remove('active'));
    inputAmount.value = '';
    inputNote.value   = '';
    inputDate.value   = DateHelpers.today();
    formError.classList.add('hidden');

    // Pré-remplissage (édition)
    if (prefill.type)   selectType(prefill.type);
    if (prefill.vault)  selectVault(prefill.vault);
    if (prefill.amount) inputAmount.value = prefill.amount;
    if (prefill.note)   inputNote.value   = prefill.note;
    if (prefill.date)   inputDate.value   = prefill.date;

    overlay.classList.remove('hidden');
    requestAnimationFrame(() => inputAmount.focus());
  }

  function close() { overlay.classList.add('hidden'); editId = null; }

  function showError(msg) {
    formError.textContent = msg;
    formError.classList.remove('hidden');
  }

  btnClose.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  btnSubmit.addEventListener('click', () => {
    formError.classList.add('hidden');

    if (!selectedType)  return showError("Sélectionne un type d'opération.");
    if (!selectedVault) return showError('Sélectionne une coffrette.');

    const raw = parseFloat(inputAmount.value.replace(',', '.'));
    if (!raw || raw <= 0) return showError('Montant invalide.');

    const payload = {
      type:   selectedType,
      vault:  selectedVault,
      amount: raw,
      note:   inputNote.value.trim(),
      date:   inputDate.value || DateHelpers.today(),
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
    const vaultCtx = Router.getVaultContext();
    if (vaultCtx) Render.vault({ vault: vaultCtx });
  });

  [inputAmount, inputNote, inputDate].forEach(el =>
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnSubmit.click(); })
  );

  return { open, close };
})();

/* ── CONFIRM DELETE ───────────────────────────────────────── */
const Confirm = (() => {
  const overlay    = document.getElementById('confirmOverlay');
  const btnCancel  = document.getElementById('btnCancelDelete');
  const btnConfirm = document.getElementById('btnConfirmDelete');
  let pendingId = null;
  let afterCb   = null;

  function ask(id, cb) { pendingId = id; afterCb = cb; overlay.classList.remove('hidden'); }
  function close() { overlay.classList.add('hidden'); pendingId = null; }

  btnCancel.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  btnConfirm.addEventListener('click', () => {
    if (!pendingId) return;
    Operations.remove(pendingId);
    UI.toast('Opération supprimée');
    close();
    Render.home();
    afterCb?.();
  });

  return { ask };
})();

/* ── RENDER ───────────────────────────────────────────────── */
const Render = (() => {
  function home() {
    const { vaults } = Storage.getState();
    const total = vaults.paris + vaults.ivry;

    document.getElementById('totalAmount').textContent    = Currency.format(total);
    document.getElementById('totalSubParis').textContent  = `Paris ${Currency.format(vaults.paris)}`;
    document.getElementById('totalSubIvry').textContent   = `Ivry ${Currency.format(vaults.ivry)}`;
    document.getElementById('amountParis').textContent    = Currency.format(vaults.paris);
    document.getElementById('amountIvry').textContent     = Currency.format(vaults.ivry);
    document.getElementById('amountExpenses').textContent = Currency.format(Operations.monthlyExpenses());
    document.getElementById('amountIncomes').textContent  = Currency.format(Operations.monthlyIncomes());

    const recent = Storage.getState().operations.slice(0, 5);
    UI.renderOpList(document.getElementById('recentList'), recent, "Aucune opération pour l'instant");
  }

  function vault({ vault }) {
    const { vaults, operations } = Storage.getState();
    const name = vault === 'paris' ? '🗼 Paris' : '🏢 Ivry';
    document.getElementById('vaultHeroLabel').textContent  = `Coffrette ${name}`;
    document.getElementById('vaultHeroAmount').textContent = Currency.format(vaults[vault]);

    const ops = operations.filter(o => o.vault === vault);
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
    const filterSelect   = document.getElementById('filterMonth');
    const container      = document.getElementById('historyContent');

    // Mois disponibles
    const months = [...new Set(operations.map(o => DateHelpers.toMonthKey(o.date)))].sort().reverse();
    const cur = filterSelect.value;
    filterSelect.innerHTML = '<option value="all">Tous les mois</option>';
    months.forEach(mk => {
      const [y, m] = mk.split('-').map(Number);
      const label  = new Date(y, m-1, 1).toLocaleDateString('fr-FR', { month:'long', year:'numeric' });
      const opt    = document.createElement('option');
      opt.value    = mk;
      opt.textContent = label.charAt(0).toUpperCase() + label.slice(1);
      filterSelect.appendChild(opt);
    });
    if (cur && cur !== 'all') filterSelect.value = cur;

    const filter   = filterSelect.value;
    const filtered = filter === 'all' ? operations
      : operations.filter(o => DateHelpers.toMonthKey(o.date) === filter);

    if (!filtered.length) {
      container.innerHTML = '<p class="empty-state">Aucune opération</p>';
      return;
    }

    // Grouper par mois
    const groups = {};
    filtered.forEach(op => {
      const mk = DateHelpers.toMonthKey(op.date);
      (groups[mk] = groups[mk] || []).push(op);
    });

    container.innerHTML = '';
    Object.entries(groups)
      .sort(([a],[b]) => b.localeCompare(a))
      .forEach(([mk, ops]) => {
        const [y, m] = mk.split('-').map(Number);
        const monthName = new Date(y, m-1, 1).toLocaleDateString('fr-FR', { month:'long', year:'numeric' });
        const totalIn   = ops.filter(o => o.type === 'income').reduce((s,o) => s + o.amount, 0);
        const totalOut  = ops.filter(o => o.type === 'expense').reduce((s,o) => s + o.amount, 0);

        const group = document.createElement('div');
        group.className = 'history-month';
        group.innerHTML = `
          <div class="month-header">
            <span class="month-title">${monthName.charAt(0).toUpperCase() + monthName.slice(1)}</span>
            <div class="month-stats">
              ${totalIn  ? `<span class="month-stat month-stat--in">+${Currency.format(totalIn)}</span>`  : ''}
              ${totalOut ? `<span class="month-stat month-stat--out">−${Currency.format(totalOut)}</span>` : ''}
            </div>
          </div>`;

        const list = document.createElement('div');
        list.className = 'ops-list';
        ops.forEach(op => list.appendChild(UI.createOpItem(op, { showEdit: true, showDelete: true })));
        group.appendChild(list);
        container.appendChild(group);
      });
  }

  return { home, vault, expenses, incomes, history };
})();

/* ── EVENT DELEGATION ─────────────────────────────────────── */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;

  const { action, vault, detail, id } = el.dataset;

  if (action === 'open-vault')   return Router.navigate('vault', { vault });
  if (action === 'open-detail')  return Router.navigate(detail);

  if (action === 'edit') {
    const op = Storage.getState().operations.find(o => o.id === id);
    if (op) Modal.open({ ...op });
    return;
  }

  if (action === 'delete') {
    Confirm.ask(id, () => {
      const ctx = Router.getVaultContext();
      ctx ? Render.vault({ vault: ctx }) : Render.history();
    });
    return;
  }
});

document.getElementById('fab').addEventListener('click', () => Modal.open());
document.getElementById('btnSeeAll').addEventListener('click', () => Router.navigate('history'));
document.getElementById('filterMonth').addEventListener('change', () => Render.history());

/* ── INIT ─────────────────────────────────────────────────── */
(function init() {
  Storage.load();
  Render.home();
})();