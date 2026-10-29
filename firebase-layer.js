/* ------------------------------------------------------------------
   Firebase layer (Authentication + Cloud Firestore) for GitHub Pages.
   index.html keeps the UI, OT calculation (calculateOT), dashboard and
   Excel export. This file only changes WHERE data comes from and goes to.
   Real protection is in the Firestore Security Rules, not in this file.
   ------------------------------------------------------------------ */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut as fbSignOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const app = initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
let me = null, booted = false, unsubs = [], usersCache = [];
const isAdminUser = () => !!me && me.role === 'admin';

// Nothing from Firestore is saved in the browser; only harmless UI preferences.
saveStore = function () {
  try { localStorage.setItem('novacPrefs', JSON.stringify({ currentMonth: store.settings.currentMonth, errorCount: store.settings.errorCount, duplicateCount: store.settings.duplicateCount })); return true; } catch (e) { return false; }
};
try { const p = JSON.parse(localStorage.getItem('novacPrefs') || 'null'); if (p) Object.assign(store.settings, p); } catch (e) {}

function friendly(e) {
  const c = (e && e.code) || '';
  if (c === 'permission-denied') return 'Not permitted (other department, inactive employee, or data not allowed by the rules).';
  if (c === 'unavailable') return 'No connection to Firebase. Check your internet and try again.';
  return (e && e.message) || 'Request failed.';
}

/* ---------- login screen ---------- */
function showLogin(msg) {
  let o = document.getElementById('loginOverlay');
  if (!o) {
    o = document.createElement('div'); o.id = 'loginOverlay'; o.className = 'modal-overlay show'; o.style.zIndex = 9999;
    o.innerHTML = '<div class="modal-box" style="max-width:380px"><h3>Novac OT Management</h3><p class="note">Sign in with the email and password given to you by the Administrator.</p>' +
      '<div style="display:grid;gap:10px;margin-bottom:12px"><input type="email" id="lgUser" placeholder="Email" autocomplete="username"><input type="password" id="lgPass" placeholder="Password" autocomplete="current-password"></div>' +
      '<p id="lgErr" style="color:var(--danger);font-size:13px;min-height:18px;margin:0 0 10px"></p><button class="btn btn-primary" id="lgBtn" style="width:100%">Sign in</button></div>';
    document.body.appendChild(o);
    const go = async () => {
      const u = document.getElementById('lgUser').value.trim(), p = document.getElementById('lgPass').value;
      if (!u || !p) { document.getElementById('lgErr').textContent = 'Enter email and password.'; return; }
      document.getElementById('lgBtn').disabled = true;
      try { await signInWithEmailAndPassword(auth, u, p); document.getElementById('lgPass').value = ''; }
      catch (e) { document.getElementById('lgErr').textContent = (e.code === 'auth/too-many-requests') ? 'Too many attempts. Wait a few minutes and try again.' : 'Sign-in failed. Check your email and password.'; }
      document.getElementById('lgBtn').disabled = false;
    };
    document.getElementById('lgBtn').onclick = go;
    document.getElementById('lgPass').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }
  o.style.display = ''; o.classList.add('show');
  document.getElementById('lgErr').textContent = msg || '';
}
function hideLogin() { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; }
function stopListening() { unsubs.forEach(u => u()); unsubs = []; }
async function signOut() { await fbSignOut(auth); }

/* ---------- live data (Firestore filters by department through the rules) ---------- */
function refreshViews() {
  const v = (document.querySelector('.view.active') || {}).id || '';
  populateEmployeeDropdown(); populateFilterOptions(); renderDashboard();
  const f = { 'view-records': renderRecordsTable, 'view-summary': renderSummary, 'view-export': renderExportView, 'view-admin': renderAdmin, 'view-quality': renderQuality, 'view-users': renderUsers }[v];
  if (f) f();
}
function listen(q, onData) {
  return new Promise((resolve, reject) => {
    let first = true;
    const un = onSnapshot(q, snap => { onData(snap); if (first) { first = false; resolve(); } else refreshViews(); },
      err => { if (first) { first = false; reject(err); } else toast(friendly(err), 'error'); });
    unsubs.push(un);
  });
}
const scoped = name => isAdminUser() ? collection(db, name) : query(collection(db, name), where('dept', '==', me.role));
const scopedOTRecords = () => isAdminUser()
  ? collection(db, 'otRecords')
  : query(
      collection(db, 'otRecords'),
      where('dept', '==', me.role),
      where('enteredBy', '==', me.uid)
    );

async function enter(user) {
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    const p = snap.exists() ? snap.data() : null;
    if (!p || p.active !== true) { await fbSignOut(auth); showLogin('This account has no access or is deactivated. Contact the Administrator.'); return; }
    me = { uid: user.uid, email: user.email, ...p };
    stopListening();
    await Promise.all([
      listen(scoped('employees'), s => { store.employees = s.docs.map(d => d.data()); }),
      listen(scopedOTRecords(), s => { store.records = s.docs.map(d => ({ id: d.id, ...d.data() })); }),
      listen(collection(db, 'holidays'), s => { store.holidays = s.docs.map(d => d.data()); })]);
    if (isAdminUser()) listen(collection(db, 'users'), s => { usersCache = s.docs.map(d => ({ uid: d.id, ...d.data() })); if (document.getElementById('view-users').classList.contains('active')) renderUsers(); }).catch(() => {});
    setupUi();
    if (!booted) { booted = true; init(); } else { renderDashboard(); }
    hideLogin(); showView('home');
  } catch (e) { stopListening(); showLogin('Could not load data: ' + friendly(e)); }
}
function setupUi() {
  const scope = isAdminUser() ? 'Admin - all departments' : 'Department ' + me.role + ' only';
  document.querySelector('.demo-banner').innerHTML = '<strong>Signed in as ' + escapeHtml(me.username) + '</strong> (' + scope + '). Data is stored centrally in Firebase and shared live between authorized users.';
  const av = document.querySelector('.avatar'); av.textContent = me.username.slice(0, 2).toUpperCase(); av.title = me.username + ' (' + me.role + ')';
  if (!document.getElementById('signOutBtn')) {
    const b = document.createElement('button'); b.className = 'btn btn-outline btn-sm'; b.id = 'signOutBtn'; b.textContent = 'Sign out'; b.onclick = signOut;
    document.querySelector('.header-right').appendChild(b);
  }
  document.getElementById('navUsers').classList.toggle('hidden', !isAdminUser());
  ['admEmpCode', 'admHolDate'].forEach(id => { const f = document.getElementById(id).closest('.admin-add-form'); f.classList.toggle('hidden', !isAdminUser()); f.nextElementSibling.classList.toggle('hidden', !isAdminUser()); });
  document.querySelector('#view-settings .page-head p').textContent = 'Signed in as ' + me.username + ' (' + me.role + ')';
  document.querySelector('#view-audit .page-head p').textContent = 'Not yet connected to Firebase.';
  const sb = document.querySelector('#view-submissions .demo-banner'); if (sb) sb.classList.add('hidden');
  const v = document.getElementById('view-settings'); v.querySelectorAll('.card').forEach(c => c.remove());
  const c = document.createElement('div'); c.className = 'card'; c.style.cssText = 'max-width:640px';
  c.innerHTML = '<h3 style="margin-bottom:8px">Your account</h3><p class="note">Signed in as <strong>' + escapeHtml(me.username) + '</strong>, role <strong>' + escapeHtml(me.role) + '</strong>' + (me.role === 'admin' ? ', all departments' : ', department <strong>' + escapeHtml(me.role) + '</strong>') +
    '. Only the Administrator can change roles, departments, access and passwords.</p><button class="btn btn-outline btn-sm" id="stSignOut">Sign out</button>';
  v.appendChild(c); c.querySelector('#stSignOut').onclick = signOut;
}

/* ---------- OT records ---------- */
const stamp = () => new Date().toISOString();
addOrUpdateOTRecord = async function () {
  const f = getFormData();
  if (!validateRequiredFields(f)) return;
  const calc = calculateOT(f);
  if (!calc.valid) { store.settings.errorCount++; saveStore(); renderDashboard(); toast(calc.error, 'error'); return; }
  if (isDuplicateRecord(f, editingRecordId)) { store.settings.duplicateCount++; saveStore(); renderDashboard(); toast('Duplicate OT entry found for this employee and timing.', 'error'); return; }
  const emp = store.employees.find(e => e.empCode === f.empCode);
  if (!emp) { toast('Employee not found in the Employee Master.', 'error'); return; }
  const old = editingRecordId ? store.records.find(r => r.id === editingRecordId) : null;
  const src = old && old.empCode === f.empCode ? old : emp;
  const data = { empCode: f.empCode, empName: src.empName, dept: old ? old.dept : emp.dept, team: src.team, lead: src.lead,
    inDate: f.inDate, inTime: f.inTime, outDate: f.outDate, outTime: f.outTime,
    totalDurationHours: Number(calc.totalDurationHours.toFixed(4)), otHours: Number(calc.otHours.toFixed(4)),
    dayType: calc.dayType, otType: String(calc.otType), status: 'Valid',
    enteredBy: old ? old.enteredBy : me.uid, enteredByName: old ? old.enteredByName : me.username, enteredDate: old ? old.enteredDate : stamp(),
    modifiedBy: old ? me.username : '', modifiedDate: old ? stamp() : '' };
  try {
    const ref = old ? doc(db, 'otRecords', old.id) : doc(collection(db, 'otRecords'));
    await setDoc(ref, data);
  } catch (e) { toast(friendly(e), 'error'); return; }
  toast(old ? '✓ OT record updated successfully.' : '✓ OT record added successfully.', 'success');
  if (old) exitEditMode();
  ['inDate', 'inTime', 'outDate', 'outTime'].forEach(id => document.getElementById(id).value = '');
  clearFieldErrors(); updateCalcCard(); renderDashboard();
};
confirmDelete = async function () {
  const id = pendingDeleteId; pendingDeleteId = null;
  document.getElementById('deleteModal').classList.remove('show');
  if (!id) return;
  try { await deleteDoc(doc(db, 'otRecords', id)); toast('OT record deleted.', 'success'); }
  catch (e) { toast(friendly(e), 'error'); }
};

/* ---------- features not connected to Firestore yet (shown honestly) ---------- */
getSub = () => ({ status: 'Not tracked', comment: '', updated: '' });
setSub = () => {};
addAudit = () => {};
const soon = (holder, title) => { document.getElementById(holder).innerHTML = '<div class="empty-state"><div class="ic">🚧</div><h3>' + title + ' is not connected yet.</h3><p>It will be added to Firebase in a later step. Nothing is stored locally in the meantime.</p></div>'; };
renderSubmissions = () => soon('subHolder', 'Monthly submission workflow');
renderAudit = () => soon('auditHolder', 'The audit log');
const _renderDashboard = renderDashboard;
renderDashboard = function () {
  _renderDashboard();
  document.querySelectorAll('#kpiGrid .kpi-card').forEach(k => { if (/Depts Approved/.test(k.textContent)) k.remove(); });
};

/* ---------- employee + holiday masters (Admin writes; others read-only) ---------- */
function replaceBtn(id, fn) { const o = document.getElementById(id), n = o.cloneNode(true); o.replaceWith(n); n.addEventListener('click', fn); }
renderAdmin = function () {
  const adm = isAdminUser();
  const eh = document.getElementById('admEmployeeTable');
  eh.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Code</th><th>Name</th><th>Dept</th><th>Team</th><th>Lead</th><th>Status</th>' + (adm ? '<th>Action</th>' : '') + '</tr></thead><tbody>' +
    store.employees.map((e, i) => '<tr><td>' + escapeHtml(e.empCode) + '</td><td>' + escapeHtml(e.empName) + '</td><td>' +
      (adm ? '<select data-emp-dept="' + i + '" aria-label="Department">' + DEPTS.map(d => '<option' + (d === e.dept ? ' selected' : '') + '>' + d + '</option>').join('') + '</select>' : escapeHtml(e.dept)) +
      '</td><td>' + escapeHtml(e.team) + '</td><td>' + escapeHtml(e.lead) + '</td><td><span class="badge ' + (e.active ? 'badge-success' : 'badge-warn') + '">' + (e.active ? 'Active' : 'Inactive') + '</span></td>' +
      (adm ? '<td><div class="row-actions"><button class="btn btn-outline btn-sm" data-toggle-emp="' + i + '">' + (e.active ? 'Deactivate' : 'Activate') + '</button><button class="btn btn-danger btn-sm" data-del-emp="' + i + '">Delete</button></div></td>' : '') + '</tr>').join('') + '</tbody></table></div>';
  const empRef = e => doc(db, 'employees', e.empCode);
  eh.querySelectorAll('[data-emp-dept]').forEach(s => s.addEventListener('change', async () => {
    const e = store.employees[+s.dataset.empDept];
    try { await updateDoc(empRef(e), { dept: s.value }); toast('Department updated. Existing OT records keep their original department.', 'success'); } catch (x) { toast(friendly(x), 'error'); renderAdmin(); }
  }));
  eh.querySelectorAll('[data-toggle-emp]').forEach(b => b.addEventListener('click', async () => {
    const e = store.employees[+b.dataset.toggleEmp];
    try { await updateDoc(empRef(e), { active: !e.active }); } catch (x) { toast(friendly(x), 'error'); }
  }));
  eh.querySelectorAll('[data-del-emp]').forEach(b => b.addEventListener('click', () => {
    const e = store.employees[+b.dataset.delEmp];
    askConfirm('Delete employee ' + e.empCode + '?', 'Existing OT records stay, but this employee leaves the master. Deactivate instead if unsure.', async () => {
      try { await deleteDoc(empRef(e)); toast('Employee removed from master.', 'success'); } catch (x) { toast(friendly(x), 'error'); }
    });
  }));
  const hh = document.getElementById('admHolidayTable');
  hh.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Name</th><th>Type</th>' + (adm ? '<th>Action</th>' : '') + '</tr></thead><tbody>' +
    store.holidays.slice().sort((a, b) => a.date.localeCompare(b.date)).map(h => '<tr><td>' + formatDateDisplay(h.date) + '</td><td>' + escapeHtml(h.name) + '</td><td>' + escapeHtml(h.type || 'Public') + '</td>' +
      (adm ? '<td><button class="btn btn-danger btn-sm" data-del-hol="' + h.date + '">Delete</button></td>' : '') + '</tr>').join('') + '</tbody></table></div>';
  hh.querySelectorAll('[data-del-hol]').forEach(b => b.addEventListener('click', async () => {
    try { await deleteDoc(doc(db, 'holidays', b.dataset.delHol)); toast('Holiday removed from master.', 'success'); } catch (x) { toast(friendly(x), 'error'); }
  }));
};
replaceBtn('admAddEmpBtn', async () => {
  const v = id => document.getElementById(id).value.trim();
  const e = { empCode: v('admEmpCode'), empName: v('admEmpName'), dept: v('admEmpDept'), team: v('admEmpTeam'), lead: v('admEmpLead'), active: true };
  if (!e.empCode || !e.empName || !e.team || !e.lead) { toast('Please fill in all employee fields.', 'error'); return; }
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(e.empCode)) { toast('Employee code: letters, numbers, - and _ only (max 20).', 'error'); return; }
  if (store.employees.some(x => x.empCode === e.empCode)) { toast('An employee with this code already exists.', 'error'); return; }
  try { await setDoc(doc(db, 'employees', e.empCode), e); } catch (x) { toast(friendly(x), 'error'); return; }
  ['admEmpCode', 'admEmpName', 'admEmpTeam', 'admEmpLead'].forEach(id => document.getElementById(id).value = '');
  toast('✓ Employee added to master.', 'success');
});
replaceBtn('admAddHolBtn', async () => {
  const date = document.getElementById('admHolDate').value, name = document.getElementById('admHolName').value.trim(), type = document.getElementById('admHolType').value;
  if (!date || !name) { toast('Please provide a date and name for the holiday.', 'error'); return; }
  if (store.holidays.some(h => h.date === date)) { toast('A holiday is already defined for this date.', 'error'); return; }
  try { await setDoc(doc(db, 'holidays', date), { date, name, type }); } catch (x) { toast(friendly(x), 'error'); return; }
  document.getElementById('admHolDate').value = ''; document.getElementById('admHolName').value = ''; toast('✓ Holiday added to master.', 'success');
});

/* ---------- User Management (Admin only; accounts themselves are created in the Firebase Console) ---------- */
function renderUsers() {
  const h = document.getElementById('usersHolder');
  h.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>User UID</th><th>Actions</th></tr></thead><tbody>' + usersCache.map(u => {
    const self = u.uid === me.uid;
    return '<tr data-u="' + u.uid + '"><td><input type="text" value="' + escapeHtml(u.username) + '" data-f="username"' + (self ? ' disabled' : '') + '></td><td><select data-f="role"' + (self ? ' disabled' : '') + '>' +
      ['ID', 'PDN', 'GD', 'admin'].map(r => '<option' + (r === u.role ? ' selected' : '') + '>' + r + '</option>').join('') + '</select></td>' +
      '<td><span class="badge ' + (u.active ? 'badge-success' : 'badge-warn') + '">' + (u.active ? 'Active' : 'Deactivated') + '</span></td><td style="font-size:11px;word-break:break-all">' + escapeHtml(u.uid) + '</td>' +
      '<td>' + (self ? '(you)' : '<div class="row-actions"><button class="btn btn-outline btn-sm" data-a="save">Save</button><button class="btn btn-outline btn-sm" data-a="active">' + (u.active ? 'Deactivate' : 'Activate') + '</button></div>') + '</td></tr>';
  }).join('') + '</tbody></table></div>';
  h.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
    const tr = b.closest('tr'), u = usersCache.find(x => x.uid === tr.dataset.u), f = k => tr.querySelector('[data-f=' + k + ']').value.trim();
    const next = b.dataset.a === 'active' ? { ...u, active: !u.active } : { ...u, username: f('username'), role: f('role') };
    const data = { username: next.username, role: next.role, dept: next.role === 'admin' ? 'ALL' : next.role, active: next.active };
    try { await setDoc(doc(db, 'users', u.uid), data); toast('Saved.', 'success'); } catch (e) { toast(friendly(e), 'error'); }
  });
}
document.getElementById('uCreateBtn').addEventListener('click', async () => {
  const uid = document.getElementById('uUid').value.trim(), username = document.getElementById('uName').value.trim(), role = document.getElementById('uRole').value;
  if (!/^[A-Za-z0-9]{20,40}$/.test(uid)) { toast('Paste the User UID exactly as shown in Firebase Authentication.', 'error'); return; }
  if (username.length < 3) { toast('Display name needs at least 3 characters.', 'error'); return; }
  try { await setDoc(doc(db, 'users', uid), { username, role, dept: role === 'admin' ? 'ALL' : role, active: true }); }
  catch (e) { toast(friendly(e), 'error'); return; }
  ['uUid', 'uName'].forEach(id => document.getElementById(id).value = ''); toast('Access saved.', 'success');
});
const _showView = showView;
showView = function (v) { if (v === 'users' && !isAdminUser()) { toast('Admin only.', 'error'); return; } _showView(v); if (v === 'users') renderUsers(); };

/* ---------- boot ---------- */
onAuthStateChanged(auth, user => {
  if (user) { enter(user); }
  else { me = null; stopListening(); store.records = []; store.employees = []; store.holidays = []; usersCache = []; showLogin(); }
});
