'use strict';
(() => {
  const config = window.VOLUME_TEAM_CONFIG || {};
  const enabled = config.enabled === true;
  let client, member, sessionUser, channel, busy = false, revision = 0;
  let activeId = '', requestEpoch = 0, remoteDue = false, pendingDraft = null;
  let localBoards = [];
  const button = $('#team-account');
  const sync = window.TeamSync = {enabled, commit: saveEdit, switch: openBoard, rename: renameBoard, create: createBoard, undo: undoEdit};
  if (!enabled) {
    button.onclick = () => { $('#team-setup-message').hidden = false; $('#team-auth-fields').hidden = true; $('#team-auth').showModal(); };
    $('#team-auth-close').onclick = () => $('#team-auth').close();
    return;
  }
  document.body.classList.add('sync-locked');
  $('.phase-pill').textContent = 'PHASE 02';
  $('#editing-as').disabled = true;
  $('#editing-as').closest('label').firstChild.textContent = 'Signed in as ';
  button.textContent = 'Sign in';
  button.onclick = () => sessionUser ? $('#team-account-dialog').showModal() : showLogin();
  $('#team-auth-close').onclick = () => $('#team-auth').close();
  $('#team-account-close').onclick = () => $('#team-account-dialog').close();
  $('#team-local-import').onclick = importLocal;
  $('#team-refresh').onclick = async () => { try { await listBoards(); if (activeId) await refreshBoard(true); else if (workspaces.length) await openBoard(workspaces[0].id, true); } catch (error) { report(error); } };
  $('#team-draft-export').onclick = exportDraft;
  $('#team-conflict-close').onclick = () => $('#team-conflict').close();
  $('#team-conflict-reload').onclick = async () => { try { await refreshBoard(true); $('#team-conflict').close(); } catch (error) { report(error); } };
  $('#team-signout').onclick = signOut;
  $('#team-auth-form').addEventListener('submit', signIn);
  window.addEventListener('online', () => { if (member && !busy) refreshBoard().catch(report); });
  window.addEventListener('beforeunload', e => { if (busy || pendingDraft) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('focus', () => { if (member && !busy) refreshBoard().catch(report); });
  captureLocalBoards();
  boot().catch(error => { status('⚠ Team connection unavailable'); $('#team-auth-error').textContent = error.message; showLogin(); });

  function status(text) { $('#save-state').textContent = text; }
  function report(error) { status('⚠ Could not sync'); toast(error.message || 'Team connection unavailable. Try again.'); }
  function ready() {
    if (!member || !activeId) { toast('Sign in and open a shared workspace first.'); return false; }
    if (busy) { toast('Saving your change. One moment…'); return false; }
    if (pendingDraft) { $('#team-conflict').showModal(); return false; }
    return true;
  }
  function showLogin() {
    $('#team-setup-message').hidden = true; $('#team-auth-fields').hidden = false;
    if (!$('#team-auth').open) $('#team-auth').showModal();
  }
  function captureLocalBoards() {
    localBoards = workspaces.map(w => {
      try {
        const raw = localStorage.getItem(storageKey(w.id));
        const data = raw ? JSON.parse(raw) : (w.id === workspaceId ? structuredClone(workspaceData()) : null);
        if (!data) return null;
        validate(data.tasks); validateMeeting(data.meeting || freshMeeting());
        return {name: w.name, data: {version: 1, tasks: data.tasks, meeting: data.meeting || freshMeeting()}};
      } catch (_) { return null; }
    }).filter(Boolean);
  }
  async function boot() {
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.supabaseUrl || '') || !config.publishableKey) throw Error('Shared login is not configured yet.');
    const sdk = await import('https://esm.sh/@supabase/supabase-js@2');
    client = sdk.createClient(config.supabaseUrl, config.publishableKey, {auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: false}});
    client.auth.onAuthStateChange((event, session) => {
      // Schedule work outside the auth callback to avoid locking the auth client.
      if (event === 'SIGNED_OUT') setTimeout(clearSession, 0);
      if (session && event !== 'TOKEN_REFRESHED' && session.user.id !== sessionUser?.id) setTimeout(() => connectUser(session.user).catch(report), 0);
    });
    const {data, error} = await client.auth.getSession();
    if (error) throw error;
    if (data.session) await connectUser(data.session.user); else showLogin();
  }
  async function signIn(e) {
    e.preventDefault(); if (!client) return;
    const submit = $('#team-auth-submit'); submit.disabled = true; $('#team-auth-error').textContent = '';
    try {
      const {data, error} = await client.auth.signInWithPassword({email: $('#team-email').value.trim(), password: $('#team-password').value});
      $('#team-password').value = '';
      if (error) throw Error('Could not sign in. Check your email and password.');
      await connectUser(data.user);
    } catch (error) { $('#team-auth-error').textContent = error.message; }
    finally { submit.disabled = false; }
  }
  let connecting = null;
  async function connectUser(user) {
    if (connecting) return connecting;
    connecting = (async () => {
      const epoch = ++requestEpoch;
      const {data, error} = await client.from('vp_team_members').select('user_id,name,role').eq('user_id', user.id).single();
      if (error || !data) { await client.auth.signOut(); throw Error('This account has not been approved for the LED Volume Team.'); }
      if (epoch !== requestEpoch) return;
      member = data; sessionUser = user; actor = member.name;
      $('#editing-as').value = actor; button.textContent = actor + ' · Account';
      $('#team-account-name').textContent = member.name + ' · ' + member.role;
      $('#team-account-email').textContent = user.email;
      $('#team-local-import').hidden = member.role !== 'admin' || !localBoards.length;
      $('#team-local-choice').innerHTML = localBoards.map((b, i) => `<option value="${i}">${esc(b.name)} (${b.data.tasks.length} tasks)</option>`).join('');
      $('#team-local-choice').hidden = member.role !== 'admin' || !localBoards.length;
      $('#team-auth').close();
      await listBoards();
      if (workspaces.length) await openBoard(workspaces[0].id, true);
      else {
        tasks = []; meeting = freshMeeting(); activity = []; undoStack = []; workspaceId = ''; activeId = '';
        render(); renderSpaces(); document.body.classList.remove('sync-locked'); status('● No shared workspace yet');
        if (member.role === 'admin') $('#team-account-dialog').showModal();
      }
      updateCopy();
    })();
    try { await connecting; } finally { connecting = null; }
  }
  async function listBoards() {
    const {data, error} = await client.from('vp_workspaces').select('id,name').order('created_at');
    if (error) throw error;
    workspaces = data; renderSpaces();
  }
  async function openBoard(id, initial = false) {
    if (!initial && !ready()) return;
    const epoch = ++requestEpoch; busy = true; status('◌ Opening shared workspace…');
    try {
      const {data, error} = await client.rpc('vp_read_workspace', {p_id: id});
      if (error) throw error;
      if (epoch !== requestEpoch) return;
      applyRow(data); activeId = id;
      if (channel) await client.removeChannel(channel);
      channel = client.channel('volume-' + id).on('postgres_changes', {event: 'UPDATE', schema: 'public', table: 'vp_workspaces', filter: 'id=eq.' + id}, () => {
        if (busy || $('#editor').open || $('#notes-editor').open || $('#workspace-dialog').open || pointer || dragged) { remoteDue = true; return; }
        refreshBoard().catch(report);
      }).subscribe(state => { if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') status('◐ Live updates disconnected · refresh available'); });
      document.body.classList.remove('sync-locked');
      status('● Shared · saved');
    } catch (error) { report(error); }
    finally { busy = false; }
  }
  function applyRow(row, keepUndo = false) {
    if (!row?.data) throw Error('Could not load the shared workspace.');
    const nextTasks = validate(row.data.tasks), nextMeeting = validateMeeting(row.data.meeting), nextActivity = validateActivity(row.activity || []);
    tasks = nextTasks; meeting = nextMeeting; activity = nextActivity; workspaceId = row.id; revision = row.revision;
    const board = workspaces.find(w => w.id === row.id); if (board) board.name = row.name;
    if (!keepUndo) undoStack = [];
    persistFailed = false; render(); renderSpaces();
    if (typeof loadFocus === 'function') { focusData = loadFocus(); renderFocus(); }
  }
  async function refreshBoard(force = false) {
    if (!member || !activeId || busy) return;
    if (!force && ($('#editor').open || $('#notes-editor').open || pointer || dragged)) { remoteDue = true; return; }
    const id = activeId, epoch = requestEpoch;
    const {data, error} = await client.rpc('vp_read_workspace', {p_id: id});
    if (error) throw error;
    if (epoch !== requestEpoch || busy || id !== activeId) return;
    if (!force && ($('#editor').open || $('#notes-editor').open || pointer || dragged)) { remoteDue = true; return; }
    if (data.revision > revision) { applyRow(data); toast('Workspace updated by the team.'); }
    remoteDue = false; status('● Shared · saved');
  }
  async function saveEdit(fn, message = 'Workspace updated', recordUndo = true) {
    if (!ready()) return false;
    const before = snapshot(), oldName = spaceName(), id = activeId, epoch = requestEpoch;
    busy = true;
    try {
      fn(); validate(tasks); validateMeeting(meeting);
      const draft = {version: 1, tasks: structuredClone(tasks), meeting: structuredClone(meeting)};
      pendingDraft = {name: spaceName(), data: draft}; status('◌ Saving to the team…'); render();
      const {data, error} = await client.rpc('vp_save_workspace', {p_id: id, p_revision: revision, p_name: spaceName(), p_data: draft, p_message: message});
      if (error) throw error;
      if (epoch !== requestEpoch) return false;
      pendingDraft = null; applyRow(data, true); if (recordUndo) undoStack.push({...before, name: oldName}); if (undoStack.length > 40) undoStack.shift();
      render(); status('● Shared · saved'); toast(message); return true;
    } catch (error) {
      if (!pendingDraft) { tasks = before.tasks; meeting = before.meeting; activity = before.activity; render(); report(error); return false; }
      tasks = before.tasks; meeting = before.meeting; activity = before.activity;
      const board = workspaces.find(w => w.id === id); if (board) board.name = oldName;
      undoStack = []; render(); renderSpaces();
      $('#team-conflict-message').textContent = error.code === '40001' ? 'A teammate saved a change first. Your attempted edit has been kept separately so nothing is silently overwritten.' : 'We could not confirm your save. Your attempted edit has been kept separately. Refresh to check the shared board before trying again.';
      $('#team-conflict').showModal(); status('⚠ Save needs review'); return false;
    } finally { busy = false; if (remoteDue && !pendingDraft) refreshBoard().catch(report); }
  }
  async function undoEdit() {
    if (!ready() || !undoStack.length) return;
    const previous = undoStack.pop();
    await saveEdit(() => { tasks = structuredClone(previous.tasks); meeting = structuredClone(previous.meeting); workspaces.find(w => w.id === workspaceId).name = previous.name || spaceName(); }, 'Last change undone', false);
  }
  function renameBoard(name) {
    if (member?.role !== 'admin') return toast('Only the workspace admin can rename shared workspaces.');
    if (name) return saveEdit(() => { workspaces.find(w => w.id === workspaceId).name = name; }, 'Workspace renamed');
  }
  async function createBoard(name, data) {
    if (member?.role !== 'admin') return toast('Only the workspace admin can create shared workspaces.');
    if (busy || pendingDraft) return toast('Finish the current save first.');
    const epoch = requestEpoch; busy = true; status('◌ Creating shared workspace…');
    try {
      validate(data.tasks); validateMeeting(data.meeting);
      const {data: row, error} = await client.rpc('vp_create_workspace', {p_id: crypto.randomUUID(), p_name: name, p_data: {version: 1, tasks: data.tasks, meeting: data.meeting}});
      if (error) throw error;
      if (epoch !== requestEpoch) return;
      await listBoards(); busy = false; await openBoard(row.id, true);
      $('#workspace-dialog').close(); $('#team-account-dialog').close(); toast('Shared workspace created');
    } catch (error) { report(error); } finally { busy = false; }
  }
  async function importLocal() {
    const board = localBoards[+$('#team-local-choice').value];
    if (!board || member?.role !== 'admin') return;
    if (!confirm(`Create a new shared workspace from “${board.name}”? Existing shared workspaces will not be replaced.`)) return;
    await createBoard(board.name, structuredClone(board.data));
  }
  function exportDraft() {
    if (!pendingDraft) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({...pendingDraft.data, exportedAt: new Date().toISOString()}, null, 2)], {type: 'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = 'volume-unsaved-edit-' + today() + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function signOut() {
    if (busy) return toast('Wait for the save to finish before signing out.');
    if (pendingDraft) return $('#team-conflict').showModal();
    const {error} = await client.auth.signOut(); if (error) return report(error);
    clearSession();
  }
  function clearSession() {
    ++requestEpoch; if (channel) client.removeChannel(channel); channel = null;
    member = null; sessionUser = null; activeId = ''; busy = false; tasks = []; meeting = freshMeeting(); activity = []; workspaces = []; undoStack = [];
    for (const dialog of $$('dialog')) if (dialog.open) dialog.close();
    $('#team-password').value = ''; document.body.classList.add('sync-locked'); button.textContent = 'Sign in'; status('○ Sign in to your team'); render(); showLogin();
  }
  function updateCopy() {
    $('.notice').querySelector('div').textContent = 'Shared team workspace · Changes save for Si, Mitch and Ken. Your signed-in account credits edits automatically.';
    $$('.history-subtitle,.notes-save-hint').forEach(el => {
      if (/self-selected|on this browser|credited to/.test(el.textContent) && !el.closest('#focus-dialog')) el.textContent = 'Shared with the team. Edits are credited to your signed-in account.';
    });
  }
  $('#team-conflict-dismiss').onclick = () => {
    if (!confirm('Discard the separately kept attempted edit? Export it first if you want to keep it.')) return;
    pendingDraft = null; $('#team-conflict').close(); refreshBoard(true).catch(report);
  };
  setInterval(() => { if (member && !busy && !pendingDraft) refreshBoard().catch(report); }, 30000);
})();
