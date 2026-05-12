/* ============================================================
   COFFRETTE — Cash Manager · app.js
   ============================================================ */
'use strict';

/* ── STORAGE ──────────────────────────────────────────────── */
const Storage = (() => {
  const KEY = 'coffrette_v3';

  /**
   * Structure :
   * vaults      : [{ id, name, emoji, balance, initialBalance }]
   * operations  : [{ id, type:'income'|'expense'|'initial', vaultId, amount, note, date }]
   * snapshots   : { 'YYYY-MM': bilanNumber }
   */
  const defaultState = () => ({
    vaults: [
      { id: 'paris', name: 'Paris', emoji: '🗼', balance: 0, initialBalance: 0 },
      { id: 'ivry',  name: 'Ivry',  emoji: '🏢', balance: 0, initialBalance: 0 },
    ],
    operations: [],
    snapshots: {},
    groups: [],
  });

  let state = defaultState();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        let parsed = JSON.parse(raw);
        // Migration depuis v2 (vaults sans initialBalance)
        if (parsed.vaults && Array.isArray(parsed.vaults)) {
          parsed.vaults = parsed.vaults.map(v => ({
            initialBalance: 0, ...v,
          }));
        }
        // Migration depuis v1 (vaults objet)
        if (parsed.vaults && !Array.isArray(parsed.vaults)) {
          parsed.vaults = [
            { id:'paris', name:'Paris', emoji:'🗼', balance: parsed.vaults.paris ?? 0, initialBalance:0 },
            { id:'ivry',  name:'Ivry',  emoji:'🏢', balance: parsed.vaults.ivry  ?? 0, initialBalance:0 },
          ];
          parsed.operations = (parsed.operations||[]).map(op => ({
            ...op, vaultId: op.vaultId ?? op.vault ?? 'paris',
          }));
        }
        if (!parsed.snapshots) parsed.snapshots = {};
        if (!parsed.groups)   parsed.groups   = [];
        state = parsed;
      }
    } catch { state = defaultState(); }
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
  const parse        = s => { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); };
  const toISO        = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const toMonthKey   = iso => iso.slice(0,7);
  const today        = ()  => toISO(new Date());
  const toShortLabel = iso => parse(iso).toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
  return { parse, toISO, toMonthKey, today, toShortLabel };
})();

/* ── CURRENCY ─────────────────────────────────────────────── */
const Currency = (() => {
  const fmt = new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:0,maximumFractionDigits:2});
  return { format: n => fmt.format(n) };
})();

/* ── VAULTS ───────────────────────────────────────────────── */
const Vaults = (() => {
  const genId = () => 'v_' + Date.now().toString(36);

  const getAll    = ()  => Storage.getState().vaults;
  const getById   = id  => getAll().find(v => v.id === id);

  function add({ name, emoji }) {
    const state = Storage.getState();
    const vault = { id: genId(), name: name.trim(), emoji: emoji||'🏦', balance: 0, initialBalance: 0 };
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

  /** Définit le solde initial (ne crée qu'une seule opération 'initial' par coffrette) */
  function setInitial(id, amount) {
    const state = Storage.getState();
    const v = state.vaults.find(v => v.id === id);
    if (!v) return;

    // Retirer l'ancienne op initial si elle existe
    const old = state.operations.find(o => o.type === 'initial' && o.vaultId === id);
    if (old) {
      v.balance     = +(v.balance - old.amount).toFixed(2);
      v.initialBalance = 0;
      state.operations = state.operations.filter(o => o.id !== old.id);
    }

    if (amount > 0) {
      const op = {
        id: 'init_' + id,
        type: 'initial',
        vaultId: id,
        amount,
        note: 'Solde initial',
        date: DateHelpers.today(),
      };
      v.balance        = +(v.balance + amount).toFixed(2);
      v.initialBalance = amount;
      state.operations.push(op);
      // Trier : les initials en dernier
      state.operations.sort((a, b) => {
        if (a.type === 'initial' && b.type !== 'initial') return 1;
        if (b.type === 'initial' && a.type !== 'initial') return -1;
        return 0;
      });
    }

    Storage.setState(state);
  }

  function remove(id) {
    const state = Storage.getState();
    state.vaults     = state.vaults.filter(v => v.id !== id);
    state.operations = state.operations.filter(o => o.vaultId !== id);
    Storage.setState(state);
  }

  return { getAll, getById, add, rename, setInitial, remove };
})();

/* ── GROUPS ───────────────────────────────────────────────── */
const Groups = (() => {
  const genId = () => 'g_' + Date.now().toString(36);
  const getAll      = ()       => Storage.getState().groups || [];
  const getById     = id       => getAll().find(g => g.id === id);
  const getForVault = vaultId  => getAll().find(g => g.vaultIds.includes(vaultId));

  function add({ name, emoji, vaultIds }) {
    const state = Storage.getState();
    const group = { id: genId(), name: name.trim(), emoji: emoji || '📦', vaultIds: [...vaultIds] };
    state.groups.push(group);
    Storage.setState(state);
    return group;
  }

  function update(id, changes) {
    const state = Storage.getState();
    const g = state.groups.find(g => g.id === id);
    if (!g) return;
    if (changes.name     !== undefined) g.name     = changes.name.trim();
    if (changes.emoji    !== undefined) g.emoji    = changes.emoji || g.emoji;
    if (changes.vaultIds !== undefined) g.vaultIds = [...changes.vaultIds];
    Storage.setState(state);
  }

  function remove(id) {
    const state = Storage.getState();
    state.groups = state.groups.filter(g => g.id !== id);
    Storage.setState(state);
  }

  return { getAll, getById, getForVault, add, update, remove };
})();

/* ── OPERATIONS ───────────────────────────────────────────── */
const Operations = (() => {
  const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);

  function _apply(state, op) {
    const v = state.vaults.find(v => v.id === op.vaultId);
    if (!v) return;
    if (op.type === 'income')   v.balance = +(v.balance + op.amount).toFixed(2);
    if (op.type === 'expense')  v.balance = +(v.balance - op.amount).toFixed(2);
    if (op.type === 'transfer') v.balance = +(v.balance - op.amount).toFixed(2);
    // 'initial' géré par Vaults.setInitial
  }

  function _revert(state, op) {
    const v = state.vaults.find(v => v.id === op.vaultId);
    if (!v) return;
    if (op.type === 'income')   v.balance = +(v.balance - op.amount).toFixed(2);
    if (op.type === 'expense')  v.balance = +(v.balance + op.amount).toFixed(2);
    if (op.type === 'transfer') v.balance = +(v.balance + op.amount).toFixed(2);
  }

  function add({ type, vaultId, amount, note, date }) {
    const state = Storage.getState();
    const op = { id: genId(), type, vaultId, amount, note: note||'', date };
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

  /** Opérations du mois courant, hors soldes initiaux et virements */
  function currentMonth() {
    const key = DateHelpers.toMonthKey(DateHelpers.today());
    return Storage.getState().operations.filter(o =>
      o.type !== 'initial' && o.type !== 'transfer' && DateHelpers.toMonthKey(o.date) === key
    );
  }

  const monthlyExpenses = () => currentMonth().filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
  const monthlyIncomes  = () => currentMonth().filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);

  function bilanForMonth(monthKey) {
    const ops = Storage.getState().operations.filter(o =>
      o.type !== 'initial' && o.type !== 'transfer' && DateHelpers.toMonthKey(o.date) === monthKey
    );
    const inc = ops.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
    const exp = ops.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
    return +(inc - exp).toFixed(2);
  }

  /** Bilan d'un mois pour une coffrette spécifique */
  function bilanForVaultMonth(vaultId, monthKey) {
    const ops = Storage.getState().operations.filter(o =>
      o.vaultId === vaultId && o.type !== 'initial' && o.type !== 'transfer' && DateHelpers.toMonthKey(o.date) === monthKey
    );
    const inc = ops.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
    const exp = ops.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
    return { inc: +(inc).toFixed(2), exp: +(exp).toFixed(2), bilan: +(inc-exp).toFixed(2) };
  }

  function snapshotPreviousMonth() {
    const state    = Storage.getState();
    const today    = new Date();
    const prevDate = new Date(today.getFullYear(), today.getMonth()-1, 1);
    const prevKey  = DateHelpers.toMonthKey(DateHelpers.toISO(prevDate));
    if (!state.snapshots[prevKey]) {
      const hasOps = state.operations.some(o => o.type!=='initial' && DateHelpers.toMonthKey(o.date)===prevKey);
      if (hasOps) {
        state.snapshots[prevKey] = bilanForMonth(prevKey);
        Storage.setState(state);
      }
    }
  }

  const getSnapshots = () => Storage.getState().snapshots || {};

  return { add, update, remove, currentMonth, monthlyExpenses, monthlyIncomes, bilanForMonth, bilanForVaultMonth, snapshotPreviousMonth, getSnapshots };
})();

/* ── UI HELPERS ───────────────────────────────────────────── */
const UI = (() => {
  const typeLabel = { income:'Rentrée', expense:'Dépense', initial:'Solde initial', transfer:'Virement' };

  function vaultLabel(vaultId) {
    const v = Vaults.getById(vaultId);
    return v ? `${v.emoji} ${v.name}` : vaultId;
  }

  function pipClass(type) {
    if (type==='income')   return 'op-pip--income';
    if (type==='expense')  return 'op-pip--expense';
    if (type==='transfer') return 'op-pip--transfer';
    return 'op-pip--initial';
  }
  function amountClass(type) {
    if (type==='income')   return 'op-amount--pos';
    if (type==='expense')  return 'op-amount--neg';
    if (type==='transfer') return 'op-amount--purple';
    return 'op-amount--blue';
  }
  function amountSign(type) {
    if (type==='income')   return '+';
    if (type==='expense')  return '−';
    if (type==='transfer') return '−';
    return '';
  }

  function createOpItem(op, opts={}) {
    const isInitial = op.type === 'initial';
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
        ${!isInitial && opts.showEdit!==false ? `
          <button class="op-btn op-btn--edit" data-action="edit" data-id="${op.id}" aria-label="Modifier">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>` : ''}
        ${!isInitial && opts.showDelete!==false ? `
          <button class="op-btn op-btn--delete" data-action="delete" data-id="${op.id}" aria-label="Supprimer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>` : ''}
      </div>
    `;
    return el;
  }

  function renderOpList(container, ops, emptyText='Aucune opération', opts={}) {
    container.innerHTML = '';
    if (!ops.length) { container.innerHTML = `<p class="empty-state">${emptyText}</p>`; return; }
    ops.forEach(op => container.appendChild(createOpItem(op, opts)));
  }

  let _toastTimer;
  function toast(msg) {
    document.querySelector('.toast')?.remove();
    clearTimeout(_toastTimer);
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    document.body.appendChild(el);
    _toastTimer = setTimeout(() => {
      el.classList.add('toast--out');
      el.addEventListener('animationend', ()=>el.remove(), {once:true});
    }, 2400);
  }

  /** Helpers bilan */
  function bilanClasses(val) {
    return val > 0 ? {amt:'bilan-amount--pos', badge:'bilan-badge--pos', inline:'op-amount--pos', mbi:'vmb-value--pos'}
         : val < 0 ? {amt:'bilan-amount--neg', badge:'bilan-badge--neg', inline:'op-amount--neg', mbi:'vmb-value--neg'}
         :            {amt:'bilan-amount--zero',badge:'bilan-badge--zero',inline:'',              mbi:''};
  }
  function bilanLabel(val) {
    return val > 0 ? 'Bénéfice' : val < 0 ? 'Déficit' : 'Équilibre';
  }
  function bilanSign(val) { return val > 0 ? '+' : ''; }

  return { createOpItem, renderOpList, toast, typeLabel, vaultLabel, bilanClasses, bilanLabel, bilanSign };
})();

/* ── ROUTER ───────────────────────────────────────────────── */
const Router = (() => {
  const views = {
    home:         document.getElementById('viewHome'),
    group:        document.getElementById('viewGroup'),
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
  let groupContext = null;

  const titles = {
    home:'Coffrette', group:'', vault:'', expenses:'Dépenses',
    incomes:'Rentrées', history:'Historique', manageVaults:'Mes coffrettes',
  };

  function navigate(viewId, params={}) {
    views[current]?.classList.remove('active');
    current      = viewId;
    vaultContext = params.vaultId  || null;
    groupContext = params.groupId  || null;
    views[viewId].classList.add('active');
    views[viewId].scrollTop = 0;

    const isHome = viewId === 'home';
    btnBack.classList.toggle('hidden', isHome);
    btnHistory.classList.toggle('hidden', !isHome);

    if (viewId === 'vault' && params.vaultId) {
      const v = Vaults.getById(params.vaultId);
      headerTitle.textContent = v ? `${v.emoji} ${v.name}` : 'Coffrette';
    } else if (viewId === 'group' && params.groupId) {
      const g = Groups.getById(params.groupId);
      headerTitle.textContent = g ? `${g.emoji} ${g.name}` : 'Groupe';
    } else {
      headerTitle.textContent = titles[viewId] || 'Coffrette';
    }

    Render[viewId]?.(params);
  }

  btnBack.addEventListener('click', ()=>navigate('home'));
  btnHistory.addEventListener('click', ()=>navigate('history'));

  const getVaultContext = () => vaultContext;
  const getGroupContext = () => groupContext;
  return { navigate, getVaultContext, getGroupContext };
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

  let editId=null, selectedType=null, selectedVault=null;

  function buildVaultButtons() {
    vaultRow.innerHTML = '';
    Vaults.getAll().forEach(v => {
      const btn = document.createElement('button');
      btn.type='button'; btn.className='vault-btn'+(v.id===selectedVault?' active':'');
      btn.dataset.vault=v.id; btn.textContent=`${v.emoji} ${v.name}`;
      btn.addEventListener('click', ()=>selectVault(v.id));
      vaultRow.appendChild(btn);
    });
  }

  function selectType(type) {
    selectedType=type;
    typeBtns.forEach(b=>b.classList.toggle('active', b.dataset.type===type));
  }
  function selectVault(id) {
    selectedVault=id;
    vaultRow.querySelectorAll('.vault-btn').forEach(b=>b.classList.toggle('active', b.dataset.vault===id));
  }

  typeBtns.forEach(b=>b.addEventListener('click', ()=>selectType(b.dataset.type)));

  function open(prefill={}) {
    editId=prefill.id||null;
    modalTitle.textContent = editId ? "Modifier l'opération" : 'Nouvelle opération';
    btnSubmit.textContent  = editId ? 'Enregistrer les modifications' : 'Enregistrer';
    selectedType=null; selectedVault=prefill.vaultId||null;
    typeBtns.forEach(b=>b.classList.remove('active'));
    inputAmount.value=''; inputNote.value='';
    inputDate.value=DateHelpers.today();
    formError.classList.add('hidden');
    buildVaultButtons();
    if (prefill.type)    selectType(prefill.type);
    if (prefill.vaultId) selectVault(prefill.vaultId);
    if (prefill.amount)  inputAmount.value=prefill.amount;
    if (prefill.note)    inputNote.value=prefill.note;
    if (prefill.date)    inputDate.value=prefill.date;
    overlay.classList.remove('hidden');
    requestAnimationFrame(()=>inputAmount.focus());
  }

  function close() { overlay.classList.add('hidden'); editId=null; }
  function showError(msg) { formError.textContent=msg; formError.classList.remove('hidden'); }

  btnClose.addEventListener('click', close);
  overlay.addEventListener('click', e=>{ if(e.target===overlay) close(); });

  btnSubmit.addEventListener('click', ()=>{
    formError.classList.add('hidden');
    if (!selectedType)  return showError("Sélectionne un type d'opération.");
    if (!selectedVault) return showError('Sélectionne une coffrette.');
    const raw = parseFloat(inputAmount.value.replace(',','.'));
    if (!raw || raw<=0) return showError('Montant invalide.');
    const payload = { type:selectedType, vaultId:selectedVault, amount:raw,
      note:inputNote.value.trim(), date:inputDate.value||DateHelpers.today() };
    if (editId) { Operations.update(editId, payload); UI.toast('Opération modifiée ✓'); }
    else        { Operations.add(payload);             UI.toast('Opération ajoutée ✓'); }
    close();
    Render.home();
    const ctx = Router.getVaultContext();
    if (ctx) Render.vault({ vaultId:ctx });
    const groupCtx = Router.getGroupContext();
    if (groupCtx) Render.group({ groupId: groupCtx });
  });

  [inputAmount,inputNote,inputDate].forEach(el=>
    el.addEventListener('keydown', e=>{ if(e.key==='Enter') btnSubmit.click(); })
  );
  return { open, close };
})();

/* ── MODAL SOLDE INITIAL ──────────────────────────────────── */
const InitialModal = (() => {
  const overlay    = document.getElementById('initialModalOverlay');
  const btnClose   = document.getElementById('initialModalClose');
  const btnSubmit  = document.getElementById('initialSubmit');
  const titleEl    = document.getElementById('initialModalTitle');
  const input      = document.getElementById('initialAmount');
  const errorEl    = document.getElementById('initialError');
  let vaultId = null;

  function open(id) {
    vaultId = id;
    const v = Vaults.getById(id);
    titleEl.textContent = `Solde initial · ${v?.emoji||''} ${v?.name||''}`;
    input.value = v?.initialBalance > 0 ? v.initialBalance : '';
    errorEl.classList.add('hidden');
    overlay.classList.remove('hidden');
    requestAnimationFrame(()=>input.focus());
  }
  function close() { overlay.classList.add('hidden'); vaultId=null; }
  function showError(msg) { errorEl.textContent=msg; errorEl.classList.remove('hidden'); }

  btnClose.addEventListener('click', close);
  overlay.addEventListener('click', e=>{ if(e.target===overlay) close(); });

  btnSubmit.addEventListener('click', ()=>{
    errorEl.classList.add('hidden');
    const raw = parseFloat(input.value.replace(',','.'));
    if (isNaN(raw) || raw < 0) return showError('Montant invalide.');
    Vaults.setInitial(vaultId, raw);
    UI.toast('Solde initial enregistré ✓');
    close();
    Render.home();
    Render.manageVaults();
    const ctx = Router.getVaultContext();
    if (ctx === vaultId) Render.vault({ vaultId: ctx });
  });

  input.addEventListener('keydown', e=>{ if(e.key==='Enter') btnSubmit.click(); });
  return { open };
})();

/* ── MODAL MODIFIER SOLDE ─────────────────────────────────── */
const BalanceEditModal = (() => {
  const overlay   = document.getElementById('balanceEditOverlay');
  const btnClose  = document.getElementById('balanceEditClose');
  const btnSubmit = document.getElementById('balanceEditSubmit');
  const titleEl   = document.getElementById('balanceEditTitle');
  const currentEl = document.getElementById('balanceEditCurrent');
  const input     = document.getElementById('balanceEditInput');
  const errorEl   = document.getElementById('balanceEditError');
  let vaultId = null;

  function open(id) {
    vaultId = id;
    const v = Vaults.getById(id);
    titleEl.textContent  = `${v?.emoji || ''} ${v?.name || ''} · Modifier le solde`;
    currentEl.textContent = Currency.format(v?.balance || 0);
    input.value = '';
    errorEl.classList.add('hidden');
    overlay.classList.remove('hidden');
    requestAnimationFrame(() => input.focus());
  }

  function close() { overlay.classList.add('hidden'); vaultId = null; }
  function showError(msg) { errorEl.textContent = msg; errorEl.classList.remove('hidden'); }

  btnClose.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  btnSubmit.addEventListener('click', () => {
    errorEl.classList.add('hidden');
    const newBalance = parseFloat(input.value.replace(',', '.'));
    if (isNaN(newBalance) || newBalance < 0) return showError('Montant invalide.');
    const v    = Vaults.getById(vaultId);
    const diff = +(newBalance - v.balance).toFixed(2);
    if (diff === 0) { close(); return; }
    const type   = diff > 0 ? 'income' : 'expense';
    const amount = Math.abs(diff);
    Operations.add({ type, vaultId, amount, note: '', date: DateHelpers.today() });
    UI.toast(diff > 0 ? `Rentrée de ${Currency.format(amount)} ✓` : `Dépense de ${Currency.format(amount)} ✓`);
    close();
    Render.home();
    Render.vault({ vaultId });
  });

  input.addEventListener('keydown', e => { if (e.key === 'Enter') btnSubmit.click(); });
  return { open };
})();

/* ── MODAL COFFRETTE ──────────────────────────────────────── */
const VaultModal = (() => {
  const overlay    = document.getElementById('vaultModalOverlay');
  const titleEl    = document.getElementById('vaultModalTitle');
  const btnClose   = document.getElementById('vaultModalClose');
  const btnSubmit  = document.getElementById('vaultModalSubmit');
  const inputEmoji = document.getElementById('vaultInputEmoji');
  const inputName  = document.getElementById('vaultInputName');
  const errorEl    = document.getElementById('vaultFormError');
  let editId=null;

  function open(vault=null) {
    editId = vault?.id||null;
    titleEl.textContent   = editId ? 'Modifier la coffrette' : 'Nouvelle coffrette';
    btnSubmit.textContent = editId ? 'Enregistrer' : 'Ajouter';
    inputEmoji.value = vault?.emoji||''; inputName.value=vault?.name||'';
    errorEl.classList.add('hidden');
    overlay.classList.remove('hidden');
    requestAnimationFrame(()=>inputName.focus());
  }
  function close() { overlay.classList.add('hidden'); editId=null; }
  function showError(msg) { errorEl.textContent=msg; errorEl.classList.remove('hidden'); }

  btnClose.addEventListener('click', close);
  overlay.addEventListener('click', e=>{ if(e.target===overlay) close(); });

  btnSubmit.addEventListener('click', ()=>{
    errorEl.classList.add('hidden');
    const name=inputName.value.trim(), emoji=inputEmoji.value.trim()||'🏦';
    if (!name) return showError('Donne un nom à la coffrette.');
    if (editId) { Vaults.rename(editId,{name,emoji}); UI.toast('Coffrette modifiée ✓'); }
    else        { Vaults.add({name,emoji});             UI.toast('Coffrette ajoutée ✓'); }
    close(); Render.home(); Render.manageVaults();
  });
  inputName.addEventListener('keydown', e=>{ if(e.key==='Enter') btnSubmit.click(); });
  return { open };
})();

/* ── CONFIRM ──────────────────────────────────────────────── */
const Confirm = (() => {
  const overlay   = document.getElementById('confirmOverlay');
  const textEl    = document.getElementById('confirmText');
  const btnCancel = document.getElementById('btnCancelDelete');
  const btnOk     = document.getElementById('btnConfirmDelete');
  let _cb=null;
  function ask(msg,cb){ textEl.textContent=msg; _cb=cb; overlay.classList.remove('hidden'); }
  function close(){ overlay.classList.add('hidden'); _cb=null; }
  btnCancel.addEventListener('click', close);
  overlay.addEventListener('click', e=>{ if(e.target===overlay) close(); });
  btnOk.addEventListener('click', ()=>{ _cb?.(); close(); });
  return { ask };
})();

/* ── RENDER ───────────────────────────────────────────────── */
const Render = (() => {

  function _vaultCard(v) {
    const card = document.createElement('div');
    card.className = 'card card--vault';
    card.dataset.action  = 'open-vault';
    card.dataset.vaultId = v.id;
    card.setAttribute('role', 'button'); card.setAttribute('tabindex', '0');
    card.innerHTML = `
      <div class="card-top">
        <span class="vault-emoji">${v.emoji}</span>
        <svg class="card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
      </div>
      <span class="card-name">${v.name}</span>
      <span class="card-amount">${Currency.format(v.balance)}</span>
    `;
    return card;
  }

  /* ── Home ── */
  function home() {
    const vaults = Vaults.getAll();
    const groups = Groups.getAll();
    const total  = vaults.reduce((s,v)=>s+v.balance, 0);
    document.getElementById('totalAmount').textContent = Currency.format(total);

    // totalSub : groupes d'abord, puis coffrettes non-groupées
    const groupedIds  = new Set(groups.flatMap(g => g.vaultIds));
    const freeVaults  = vaults.filter(v => !groupedIds.has(v.id));
    const subItems    = [];
    groups.forEach(g => {
      const bal = g.vaultIds.map(id => Vaults.getById(id)).filter(Boolean).reduce((s,v)=>s+v.balance,0);
      subItems.push(`<span>${g.emoji} ${g.name} ${Currency.format(bal)}</span>`);
    });
    freeVaults.forEach(v => subItems.push(`<span>${v.emoji} ${v.name} ${Currency.format(v.balance)}</span>`));
    document.getElementById('totalSub').innerHTML =
      subItems.map((item,i) => (i>0 ? '<span class="total-sep">·</span>' : '') + item).join('');

    // Cartes
    const container = document.getElementById('vaultCards');
    container.innerHTML = '';

    // Cartes de groupes
    groups.forEach(g => {
      const gVaults = g.vaultIds.map(id => Vaults.getById(id)).filter(Boolean);
      const gBal    = gVaults.reduce((s,v)=>s+v.balance, 0);
      const card    = document.createElement('div');
      card.className = 'card card--vault card--group';
      card.dataset.action  = 'open-group';
      card.dataset.groupId = g.id;
      card.setAttribute('role','button'); card.setAttribute('tabindex','0');
      card.innerHTML = `
        <div class="card-top">
          <span class="vault-emoji">${g.emoji}</span>
          <svg class="card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        </div>
        <span class="card-name">${g.name}</span>
        <span class="group-sub-emojis">${gVaults.map(v=>v.emoji).join('  ')}</span>
        <span class="card-amount">${Currency.format(gBal)}</span>
      `;
      container.appendChild(card);
    });

    // Cartes coffrettes non-groupées
    freeVaults.forEach(v => container.appendChild(_vaultCard(v)));

    // Stats mois
    const exp   = Operations.monthlyExpenses();
    const inc   = Operations.monthlyIncomes();
    const bilan = +(inc-exp).toFixed(2);
    document.getElementById('amountExpenses').textContent = Currency.format(exp);
    document.getElementById('amountIncomes').textContent  = Currency.format(inc);

    const cl = UI.bilanClasses(bilan);
    document.getElementById('bilanAmount').textContent  = UI.bilanSign(bilan)+Currency.format(bilan);
    document.getElementById('bilanAmount').className    = 'bilan-amount '+cl.amt;
    document.getElementById('bilanBadge').textContent   = UI.bilanLabel(bilan);
    document.getElementById('bilanBadge').className     = 'bilan-badge '+cl.badge;
    document.getElementById('bilanSub').textContent     = `+${Currency.format(inc)} − ${Currency.format(exp)}`;

    // Récent (hors initiaux et virements)
    const recent = Storage.getState().operations.filter(o=>o.type!=='initial' && o.type!=='transfer').slice(0,5);
    UI.renderOpList(document.getElementById('recentList'), recent, "Aucune opération pour l'instant");
  }

  /* ── Vault ── */
  function vault({ vaultId }) {
    const v = Vaults.getById(vaultId);
    if (!v) return;
    document.getElementById('vaultHeroLabel').textContent  = `${v.emoji} ${v.name}`;
    const heroAmountEl = document.getElementById('vaultHeroAmount');
    heroAmountEl.textContent = Currency.format(v.balance);
    heroAmountEl.dataset.action  = 'edit-balance';
    heroAmountEl.dataset.vaultId = vaultId;
    heroAmountEl.classList.add('detail-hero-amount--editable');

    const initEl = document.getElementById('vaultHeroInitial');
    initEl.textContent = v.initialBalance > 0 ? `Solde initial : ${Currency.format(v.initialBalance)}` : '';

    // Bilan mois pour cette coffrette
    const mk  = DateHelpers.toMonthKey(DateHelpers.today());
    const { inc, exp, bilan } = Operations.bilanForVaultMonth(vaultId, mk);
    document.getElementById('vaultMonthInc').textContent = Currency.format(inc);
    document.getElementById('vaultMonthExp').textContent = Currency.format(exp);
    const bilanEl = document.getElementById('vaultMonthBilanAmt');
    bilanEl.textContent = UI.bilanSign(bilan)+Currency.format(bilan);
    const cl = UI.bilanClasses(bilan);
    bilanEl.className = 'vmb-value ' + (bilan>0?'vmb-value--pos':bilan<0?'vmb-value--neg':'');

    // Ops : toutes sauf initiales en premier, initiale à la fin
    const ops = Storage.getState().operations.filter(o=>o.vaultId===vaultId);
    UI.renderOpList(document.getElementById('vaultOpsList'), ops, 'Aucune opération sur cette coffrette');
  }

  /* ── Group ── */
  function group({ groupId }) {
    const g = Groups.getById(groupId);
    if (!g) return;
    const gVaults = g.vaultIds.map(id => Vaults.getById(id)).filter(Boolean);
    const gBal    = gVaults.reduce((s,v)=>s+v.balance, 0);

    document.getElementById('groupHeroLabel').textContent  = `${g.emoji} ${g.name}`;
    document.getElementById('groupHeroAmount').textContent = Currency.format(gBal);

    // Bilan mois cumulé pour toutes les coffrettes du groupe
    const mk = DateHelpers.toMonthKey(DateHelpers.today());
    let totalInc = 0, totalExp = 0;
    gVaults.forEach(v => {
      const { inc, exp } = Operations.bilanForVaultMonth(v.id, mk);
      totalInc += inc; totalExp += exp;
    });
    const gBilan = +(totalInc - totalExp).toFixed(2);
    document.getElementById('groupMonthInc').textContent     = Currency.format(totalInc);
    document.getElementById('groupMonthExp').textContent     = Currency.format(totalExp);
    const bilanEl = document.getElementById('groupMonthBilanAmt');
    bilanEl.textContent = UI.bilanSign(gBilan) + Currency.format(gBilan);
    bilanEl.className   = 'vmb-value ' + (gBilan>0?'vmb-value--pos':gBilan<0?'vmb-value--neg':'');

    // Cartes des coffrettes à l'intérieur
    const container = document.getElementById('groupVaultCards');
    container.innerHTML = '';
    gVaults.forEach(v => container.appendChild(_vaultCard(v)));
  }

  /* ── Expenses ── */
  function expenses() {
    const ops = Operations.currentMonth().filter(o=>o.type==='expense');
    document.getElementById('expensesHeroAmount').textContent = Currency.format(Operations.monthlyExpenses());
    UI.renderOpList(document.getElementById('expensesOpsList'), ops, 'Aucune dépense ce mois-ci');
  }

  /* ── Incomes ── */
  function incomes() {
    const ops = Operations.currentMonth().filter(o=>o.type==='income');
    document.getElementById('incomesHeroAmount').textContent = Currency.format(Operations.monthlyIncomes());
    UI.renderOpList(document.getElementById('incomesOpsList'), ops, 'Aucune rentrée ce mois-ci');
  }

  /* ── History ── */
  function history() {
    const { operations } = Storage.getState();
    const snapshots      = Operations.getSnapshots();
    const filterSelect   = document.getElementById('filterMonth');
    const container      = document.getElementById('historyContent');
    const currentKey     = DateHelpers.toMonthKey(DateHelpers.today());

    // Opérations hors initiaux et virements bancaires
    const realOps = operations.filter(o=>o.type!=='initial' && o.type!=='transfer');

    const months = [...new Set(realOps.map(o=>DateHelpers.toMonthKey(o.date)))].sort().reverse();
    const cur = filterSelect.value;
    filterSelect.innerHTML = '<option value="all">Tous les mois</option>';
    months.forEach(mk=>{
      const [y,m]=mk.split('-').map(Number);
      const label = new Date(y,m-1,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
      const opt = document.createElement('option');
      opt.value=mk; opt.textContent=label.charAt(0).toUpperCase()+label.slice(1);
      filterSelect.appendChild(opt);
    });
    if (cur && cur!=='all') filterSelect.value=cur;

    const filter   = filterSelect.value;
    const filtered = filter==='all' ? realOps : realOps.filter(o=>DateHelpers.toMonthKey(o.date)===filter);

    if (!filtered.length) { container.innerHTML='<p class="empty-state">Aucune opération</p>'; return; }

    const groups={};
    filtered.forEach(op=>{ const mk=DateHelpers.toMonthKey(op.date); (groups[mk]=groups[mk]||[]).push(op); });

    container.innerHTML='';
    Object.entries(groups).sort(([a],[b])=>b.localeCompare(a)).forEach(([mk,ops])=>{
      const [y,m]=mk.split('-').map(Number);
      const monthName = new Date(y,m-1,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
      const totalIn   = ops.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
      const totalOut  = ops.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
      const bilan     = mk in snapshots ? snapshots[mk] : Operations.bilanForMonth(mk);
      const isCurrent = mk === currentKey;
      const cl        = UI.bilanClasses(bilan);

      const monthDiv = document.createElement('div');
      monthDiv.className = 'history-month';

      const card = document.createElement('div');
      card.className = 'month-card'; // fermé par défaut

      // Header cliquable
      const header = document.createElement('div');
      header.className = 'month-card-header';
      header.innerHTML = `
        <svg class="month-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="month-card-meta">
          <div class="month-card-title">
            ${monthName.charAt(0).toUpperCase()+monthName.slice(1)}
            ${isCurrent ? '<span class="month-card-badge">en cours</span>' : ''}
          </div>
          <div class="month-card-stats">
            ${totalIn  ? `<span class="month-stat month-stat--in">+${Currency.format(totalIn)}</span>`  : ''}
            ${totalOut ? `<span class="month-stat month-stat--out">−${Currency.format(totalOut)}</span>` : ''}
          </div>
        </div>
        <span class="month-bilan-inline ${cl.inline}">${UI.bilanSign(bilan)}${Currency.format(bilan)}</span>
      `;

      // Corps rétractable
      const body = document.createElement('div');
      body.className = 'month-card-body';

      // Ligne bilan dans le corps
      const bilanRow = document.createElement('div');
      bilanRow.className = 'month-bilan-row';
      bilanRow.innerHTML = `
        <span class="month-bilan-label">Bilan · ${UI.bilanLabel(bilan)}</span>
        <span class="month-bilan-val ${cl.inline}">${UI.bilanSign(bilan)}${Currency.format(bilan)}</span>
      `;
      body.appendChild(bilanRow);

      // Liste des ops
      const list = document.createElement('div');
      list.className = 'ops-list';
      ops.forEach(op=>list.appendChild(UI.createOpItem(op, {showEdit:true, showDelete:true})));
      body.appendChild(list);

      // Toggle au clic sur le header
      header.addEventListener('click', ()=>{
        card.classList.toggle('open');
      });

      card.appendChild(header);
      card.appendChild(body);
      monthDiv.appendChild(card);
      container.appendChild(monthDiv);
    });
  }

  /* ── Manage vaults ── */
  function manageVaults() {
    // ── Groupes ──
    const groupsContainer = document.getElementById('manageGroupList');
    groupsContainer.innerHTML = '';
    const allGroups = Groups.getAll();
    if (!allGroups.length) {
      groupsContainer.innerHTML = '<p class="empty-state" style="padding:10px 0 4px">Aucun groupe pour l\'instant</p>';
    } else {
      allGroups.forEach(g => {
        const gVaults  = g.vaultIds.map(id => Vaults.getById(id)).filter(Boolean);
        const totalBal = gVaults.reduce((s,v) => s+v.balance, 0);
        const item = document.createElement('div');
        item.className = 'vault-manage-item vault-manage-item--group';
        item.innerHTML = `
          <span class="vault-manage-emoji">${g.emoji}</span>
          <div class="vault-manage-info">
            <div class="vault-manage-name">${g.name}</div>
            <div class="vault-manage-amount">${Currency.format(totalBal)} · ${gVaults.map(v=>v.emoji+' '+v.name).join(', ')}</div>
          </div>
          <div class="vault-manage-actions">
            <button class="op-btn op-btn--edit" data-action="rename-group" data-id="${g.id}" aria-label="Modifier">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="op-btn op-btn--delete" data-action="delete-group" data-id="${g.id}" aria-label="Supprimer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
        `;
        groupsContainer.appendChild(item);
      });
    }

    // ── Coffrettes ──
    const container = document.getElementById('manageVaultList');
    container.innerHTML = '';
    const vaults = Vaults.getAll();
    if (!vaults.length) { container.innerHTML = '<p class="empty-state">Aucune coffrette</p>'; return; }
    vaults.forEach(v => {
      const inGroup = Groups.getForVault(v.id);
      const item = document.createElement('div');
      item.className = 'vault-manage-item';
      item.innerHTML = `
        <span class="vault-manage-emoji">${v.emoji}</span>
        <div class="vault-manage-info">
          <div class="vault-manage-name">${v.name}${inGroup ? ` <span class="vault-in-group-tag">${inGroup.emoji} ${inGroup.name}</span>` : ''}</div>
          <div class="vault-manage-amount">${Currency.format(v.balance)}${v.initialBalance>0?' · initial '+Currency.format(v.initialBalance):''}</div>
        </div>
        <div class="vault-manage-actions">
          <button class="btn-initial" data-action="set-initial" data-id="${v.id}">Solde initial</button>
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

  return { home, group, vault, expenses, incomes, history, manageVaults };
})();

/* ── MODAL GROUPE ─────────────────────────────────────────── */
const GroupModal = (() => {
  const overlay    = document.getElementById('groupModalOverlay');
  const btnClose   = document.getElementById('groupModalClose');
  const btnSubmit  = document.getElementById('groupModalSubmit');
  const titleEl    = document.getElementById('groupModalTitle');
  const inputEmoji = document.getElementById('groupInputEmoji');
  const inputName  = document.getElementById('groupInputName');
  const listEl     = document.getElementById('groupVaultList');
  const errorEl    = document.getElementById('groupFormError');
  let editId = null;

  function buildPicker(selectedIds = []) {
    listEl.innerHTML = '';
    const allGroups  = Groups.getAll();
    const selected   = new Set(selectedIds);
    Vaults.getAll().forEach(v => {
      const takenBy  = allGroups.find(g => g.id !== editId && g.vaultIds.includes(v.id));
      const isActive = selected.has(v.id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'group-vault-pick' + (isActive ? ' active' : '') + (takenBy ? ' taken' : '');
      btn.dataset.vaultId = v.id;
      if (takenBy) btn.disabled = true;
      btn.innerHTML = `
        <span class="group-vault-pick-name">${v.emoji} ${v.name}</span>
        ${takenBy ? `<span class="group-vault-pick-tag">dans ${takenBy.emoji} ${takenBy.name}</span>` : ''}
        <svg class="group-vault-pick-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      `;
      if (!takenBy) btn.addEventListener('click', () => btn.classList.toggle('active'));
      listEl.appendChild(btn);
    });
  }

  function open(group = null) {
    editId = group?.id || null;
    titleEl.textContent   = editId ? 'Modifier le groupe' : 'Nouveau groupe';
    btnSubmit.textContent = editId ? 'Enregistrer' : 'Créer le groupe';
    inputEmoji.value = group?.emoji || '';
    inputName.value  = group?.name  || '';
    errorEl.classList.add('hidden');
    buildPicker(group?.vaultIds || []);
    overlay.classList.remove('hidden');
    requestAnimationFrame(() => inputName.focus());
  }

  function close() { overlay.classList.add('hidden'); editId = null; }
  function showError(msg) { errorEl.textContent = msg; errorEl.classList.remove('hidden'); }

  btnClose.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  btnSubmit.addEventListener('click', () => {
    errorEl.classList.add('hidden');
    const name  = inputName.value.trim();
    const emoji = inputEmoji.value.trim() || '📦';
    if (!name) return showError('Donne un nom au groupe.');
    const vaultIds = [...listEl.querySelectorAll('.group-vault-pick.active')].map(b => b.dataset.vaultId);
    if (vaultIds.length < 2) return showError('Sélectionne au moins 2 coffrettes.');
    if (editId) { Groups.update(editId, { name, emoji, vaultIds }); UI.toast('Groupe modifié ✓'); }
    else        { Groups.add({ name, emoji, vaultIds });              UI.toast('Groupe créé ✓'); }
    close();
    Render.home();
    Render.manageVaults();
  });

  inputName.addEventListener('keydown', e => { if (e.key === 'Enter') btnSubmit.click(); });
  return { open };
})();

/* ── EVENT DELEGATION ─────────────────────────────────────── */
document.addEventListener('click', e=>{
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, vaultId, detail, id } = el.dataset;

  if (action==='open-vault')    return Router.navigate('vault', { vaultId });
  if (action==='open-group')   return Router.navigate('group', { groupId: el.dataset.groupId });
  if (action==='open-detail')  return Router.navigate(detail);
  if (action==='edit-balance') return BalanceEditModal.open(vaultId);

  if (action==='edit') {
    const op = Storage.getState().operations.find(o=>o.id===id);
    if (op) Modal.open({...op});
    return;
  }

  if (action==='delete') {
    Confirm.ask('Supprimer cette opération ? Cette action est irréversible.', ()=>{
      Operations.remove(id);
      UI.toast('Opération supprimée');
      Render.home();
      const ctx = Router.getVaultContext();
      if (ctx) Render.vault({vaultId:ctx}); else Render.history();
    });
    return;
  }

  if (action==='set-initial')  { InitialModal.open(id); return; }
  if (action==='rename-vault') { const v=Vaults.getById(id); if(v) VaultModal.open(v); return; }
  if (action==='rename-group') { const g=Groups.getById(id); if(g) GroupModal.open(g); return; }

  if (action==='delete-group') {
    const g = Groups.getById(id);
    if (!g) return;
    Confirm.ask(`Dissoudre le groupe "${g.name}" ? Les coffrettes restent intactes.`, () => {
      Groups.remove(id);
      UI.toast(`Groupe "${g.name}" supprimé`);
      Render.home(); Render.manageVaults();
    });
    return;
  }

  if (action==='delete-vault') {
    const v = Vaults.getById(id);
    if (!v) return;
    const opsCount = Storage.getState().operations.filter(o=>o.vaultId===v.id && o.type!=='initial').length;
    const msg = opsCount
      ? `Supprimer "${v.name}" et ses ${opsCount} opération(s) ? Cette action est irréversible.`
      : `Supprimer la coffrette "${v.name}" ? Cette action est irréversible.`;
    Confirm.ask(msg, ()=>{
      Vaults.remove(v.id);
      UI.toast(`"${v.name}" supprimée`);
      Render.home(); Render.manageVaults();
    });
    return;
  }
});

document.getElementById('fab').addEventListener('click', ()=>Modal.open());
document.getElementById('btnSeeAll').addEventListener('click', ()=>Router.navigate('history'));
document.getElementById('btnManageVaults').addEventListener('click', ()=>Router.navigate('manageVaults'));
document.getElementById('btnAddVault').addEventListener('click', ()=>VaultModal.open());
document.getElementById('btnAddGroup').addEventListener('click', ()=>GroupModal.open());
document.getElementById('filterMonth').addEventListener('change', ()=>Render.history());

/* ── INIT ─────────────────────────────────────────────────── */
(function init() {
  Storage.load();
  Operations.snapshotPreviousMonth();
  Render.home();
})();