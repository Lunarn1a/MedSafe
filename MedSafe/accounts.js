/* Supabase accounts and saved records. Public keys never replace user sessions. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const config = window.MEDSAFE_SUPABASE;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let client;
  let mode = 'signin';
  let signedInId = null;
  let pendingUser = null;
  let epoch = 0;
  let readSerial = 0;
  let authBusy = false;
  let loggingOut = false;
  let mutationBusy = false;
  let profileSaving = false;
  let links = [];
  let profiles = [];
  let recovery = new URLSearchParams(location.search).get('recovery') === '1'
    || new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';

  function message(text, error = false, target = 'account-feedback') {
    $(target).textContent = text;
    $(target).dataset.error = String(error);
  }
  function friendly(error) {
    const code = error?.code || '';
    if (code === 'invalid_credentials') return 'The email or password is incorrect.';
    if (code === 'email_not_confirmed') return 'Confirm your email using the link in your inbox, then sign in.';
    if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') return 'Too many attempts. Please wait before trying again.';
    if (code === 'email_address_not_authorized' || /sending.*email|email.*sending/i.test(error?.message || '')) return 'The email could not be sent. Ask the project administrator to check email delivery.';
    if (code === '23503') return 'Check the caregiver code. It must belong to a registered caregiver account.';
    if (code === '23505') return 'That record already exists. Refresh your records.';
    if (code === '42501') return 'You do not have permission for this change. Refresh your records or ask the patient to check your access.';
    if (code === '42P01' || code === 'PGRST205') return 'The database setup is incomplete. Ask the project administrator to finish setup.';
    if (code === 'weak_password') return 'Choose a stronger password with at least 10 characters.';
    if (error?.name === 'AbortError' || /fetch|network|timeout|failed to fetch/i.test(error?.message || '')) return 'The connection failed. Check your internet, then refresh before retrying a change.';
    return error?.message || 'Something went wrong. Please try again.';
  }
  function ensure(result) {
    if (result.error) throw result.error;
    return result.data;
  }
  function requireClient() {
    if (!client) throw new Error('Account services are unavailable. Start MedSafe with its launcher and reload this page.');
  }
  function current(id, stamp) { return signedInId === id && epoch === stamp; }
  function clearRecords() {
    patientMeds = [];
    caregiverPatients = [];
    caregiverMeds = [];
    links = [];
    profiles = [];
    currentAssignPatientId = null;
    closeEditStockModal();
    closeInteractionModal();
    $('caregiver-access-list').replaceChildren();
    renderDashboard();
  }
  function clearSessionView() {
    epoch += 1;
    readSerial += 1;
    signedInId = null;
    pendingUser = null;
    links = [];
    profiles = [];
    clearAccountView();
    message('');
  }

  function showMode(next) {
    mode = next;
    show('screen-signin');
    const creating = next === 'signup' || next === 'profile';
    const resetting = next === 'reset';
    const usesPassword = next === 'signin' || next === 'signup' || resetting;
    const titles = {signin:'Sign in', signup:'Create an account', recover:'Reset your password', reset:'Choose a new password', profile:'Complete your account'};
    $('auth-title').textContent = titles[next];
    $('auth-subtitle').textContent = creating ? 'Choose your account type. Patients control access to their records.' : resetting ? 'Enter your new password below.' : next === 'recover' ? 'We will send a password-reset link if an account is eligible.' : 'Your saved account determines whether you are a patient or caregiver.';
    $('auth-profile-fields').hidden = !creating;
    $('auth-role-choice').hidden = !creating;
    $('auth-name').required = creating;
    $('auth-birth-date').max = new Date().toLocaleDateString('en-CA');
    $('auth-email-field').hidden = next === 'profile' || resetting;
    $('email').required = next !== 'profile' && !resetting;
    $('auth-password-field').hidden = !usesPassword;
    $('password').required = usesPassword;
    $('password').minLength = next === 'signin' ? 1 : 10;
    $('password').autocomplete = next === 'signin' ? 'current-password' : 'new-password';
    $('password').value = '';
    $('auth-confirm-field').hidden = !(next === 'signup' || resetting);
    $('auth-confirm').required = next === 'signup' || resetting;
    $('auth-confirm').value = '';
    $('auth-forgot').hidden = next !== 'signin';
    $('auth-switch').hidden = next === 'profile' || resetting;
    $('auth-switch').textContent = next === 'signin' ? 'Create an account' : 'Back to sign in';
    $('auth-cancel').hidden = next !== 'profile' && !resetting;
    $('auth-submit').textContent = {signin:'Sign In', signup:'Create account', recover:'Send reset link', reset:'Save new password', profile:'Save account details'}[next];
    message('', false, 'auth-feedback');
    updateToggle();
  }

  function ageFromDate(value) {
    if (!value) return '?';
    const birth = new Date(value + 'T00:00:00');
    if (Number.isNaN(birth.valueOf())) return '?';
    const today = new Date();
    return today.getFullYear() - birth.getFullYear() - (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate()) ? 1 : 0);
  }
  function medicine(row) {
    // Saved names are not trusted HTML or JavaScript. Only canonical reference
    // names reach the old interaction renderers; free-text fields are escaped.
    const name = drugsList.find(value => value.toLowerCase() === String(row.name).toLowerCase());
    if (!name || !uuid.test(row.id) || !uuid.test(row.patient_id) || !Number.isInteger(row.stock) || row.stock < 0) {
      throw new Error('A saved medicine record is invalid. Ask the project administrator to check it.');
    }
    return {...row, name, dosage:String(row.dosage || ''), frequency:String(row.frequency || '')};
  }
  async function readRows(table) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      let query = client.from(table).select('*');
      query = table === 'caregiver_links' ? query.order('patient_id').order('caregiver_id') : query.order('id');
      const page = ensure(await query.range(offset, offset + 499));
      rows.push(...page);
      if (page.length < 500) return rows;
    }
  }
  function renderAccess() {
    const container = $('caregiver-access-list');
    container.replaceChildren();
    if (currentRole !== 'patient') return;
    if (!links.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No caregivers have access to your records.';
      container.append(empty);
    }
    for (const link of links) {
      const profile = profiles.find(row => row.id === link.caregiver_id);
      const card = document.createElement('article');
      card.className = 'account-access-card';
      const title = document.createElement('strong');
      title.textContent = profile?.display_name || 'Caregiver';
      const label = document.createElement('label');
      label.className = 'account-check';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = link.can_edit;
      toggle.addEventListener('change', () => changePermission(link.caregiver_id, toggle.checked));
      label.append(toggle, ' Allow editing medicine records');
      const revoke = document.createElement('button');
      revoke.className = 'dash-remove-btn';
      revoke.textContent = 'Remove access';
      revoke.addEventListener('click', () => revokeAccess(link.caregiver_id));
      card.append(title, label, revoke);
      container.append(card);
    }
  }

  async function refreshRecords({quiet = false} = {}) {
    if (!signedInId) return false;
    const id = signedInId, stamp = epoch, serial = ++readSerial;
    if (!quiet) message('Loading your saved records…');
    try {
      const [allProfiles, allLinks, allMedicines] = await Promise.all([
        readRows('profiles'), readRows('caregiver_links'), readRows('medicines'),
      ]);
      if (!current(id, stamp) || serial !== readSerial) return false;
      const own = allProfiles.find(row => row.id === id);
      if (!own) throw new Error('Your account profile is unavailable. Sign out and sign in again.');
      profiles = allProfiles;
      currentUser.name = own.display_name;
      currentUser.dateOfBirth = own.date_of_birth || '';
      renderAccountIdentity();
      links = allLinks.filter(row => currentRole === 'patient' ? row.patient_id === id : row.caregiver_id === id);
      const meds = allMedicines.map(medicine);
      patientMeds = currentRole === 'patient' ? meds.filter(row => row.patient_id === id) : [];
      caregiverPatients = currentRole === 'caregiver' ? links.map(link => {
        const profile = profiles.find(row => row.id === link.patient_id);
        if (!profile || !uuid.test(profile.id)) return null;
        const records = meds.filter(row => row.patient_id === profile.id);
        const newest = records.map(row => row.updated_at).sort().at(-1);
        return {id:profile.id, name:profile.display_name, age:ageFromDate(profile.date_of_birth),
          medicines:records, can_edit:link.can_edit === true,
          lastCheck:newest ? new Date(newest).toLocaleDateString() : 'No medicines', status:link.can_edit ? 'Can edit' : 'View only'};
      }).filter(Boolean) : [];
      // Close views whose permission or underlying record may have changed.
      closeEditStockModal();
      closeInteractionModal();
      renderDashboard();
      if (activeDashPage === 'assign_meds') renderAssignMedsPage();
      renderAccess();
      message('Records are up to date.');
      return true;
    } catch (error) {
      if (!current(id, stamp) || serial !== readSerial) return false;
      clearRecords();
      message(friendly(error), true);
      return false;
    }
  }

  async function insertProfile(user, name, role, birthDate) {
    if (!uuid.test(user.id) || !['patient','caregiver'].includes(role) || !name.trim()) throw new Error('Enter your name and choose an account type.');
    const result = await client.from('profiles').insert({id:user.id, display_name:name.trim(), role, date_of_birth:birthDate || null});
    // A second tab may have created the same profile; never overwrite its role.
    if (result.error && result.error.code !== '23505') throw result.error;
    return ensure(await client.from('profiles').select('*').eq('id', user.id).single());
  }
  async function hydrate(session) {
    if (!session || recovery || loggingOut) return;
    if (signedInId === session.user.id) return;
    clearSessionView();
    const stamp = epoch;
    showMode('signin');
    message('Opening your account…', false, 'auth-feedback');
    try {
      const {user} = ensure(await client.auth.getUser());
      if (stamp !== epoch) return;
      let profile = ensure(await client.from('profiles').select('*').eq('id', user.id).maybeSingle());
      if (stamp !== epoch) return;
      if (!profile) {
        const info = user.user_metadata || {};
        if (['patient','caregiver'].includes(info.medsafe_role) && typeof info.display_name === 'string' && info.display_name.trim()) {
          profile = await insertProfile(user, info.display_name, info.medsafe_role, info.date_of_birth);
        } else {
          pendingUser = user;
          showMode('profile');
          return;
        }
      }
      if (stamp !== epoch) return;
      if (!['patient','caregiver'].includes(profile.role)) throw new Error('Your account type is invalid. Contact the project administrator.');
      signedInId = user.id;
      pendingUser = null;
      currentUser = {id:user.id, email:user.email || '', role:profile.role, name:profile.display_name, dateOfBirth:profile.date_of_birth || ''};
      currentRole = profile.role;
      $('caregiver-share-code').textContent = user.id;
      openDashboard(profile.role, profile.display_name, user.email || '');
      await refreshRecords();
    } catch (error) {
      if (stamp === epoch) message(friendly(error), true, 'auth-feedback');
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (authBusy) return;
    authBusy = true;
    const submittedMode = mode;
    $('auth-submit').disabled = true;
    try {
      requireClient();
      const email = $('email').value.trim();
      const password = $('password').value;
      if (submittedMode === 'signup' || submittedMode === 'reset') {
        if (password.length < 10) throw new Error('Use at least 10 characters for your password.');
        if (password !== $('auth-confirm').value) throw new Error('The two passwords do not match.');
      }
      message('Please wait…', false, 'auth-feedback');
      if (submittedMode === 'signin') {
        const data = ensure(await client.auth.signInWithPassword({email, password}));
        $('password').value = '';
        await hydrate(data.session);
      } else if (submittedMode === 'signup') {
        const name = $('auth-name').value.trim();
        if (!name) throw new Error('Enter your name.');
        const data = ensure(await client.auth.signUp({email, password, options:{emailRedirectTo:location.origin + '/',
          data:{display_name:name, medsafe_role:currentRole, date_of_birth:$('auth-birth-date').value || null}}}));
        $('password').value = '';
        $('auth-confirm').value = '';
        if (data.session) await hydrate(data.session);
        else { showMode('signin'); message('If signup is available for this address, check your inbox to confirm your email, then sign in. If you already have an account, sign in or reset its password.', false, 'auth-feedback'); }
      } else if (submittedMode === 'recover') {
        ensure(await client.auth.resetPasswordForEmail(email, {redirectTo:location.origin + '/?recovery=1'}));
        message('If an account is eligible, a reset link will arrive by email. Open it in this same browser with MedSafe running.', false, 'auth-feedback');
      } else if (submittedMode === 'reset') {
        ensure(await client.auth.updateUser({password}));
        recovery = false;
        sessionStorage.removeItem('medsafe-recovery');
        history.replaceState(null, '', location.pathname);
        await client.auth.signOut({scope:'local'});
        clearSessionView();
        showMode('signin');
        message('Password updated. Sign in with your new password.', false, 'auth-feedback');
      } else if (submittedMode === 'profile') {
        if (!pendingUser) throw new Error('Sign in again to complete your account.');
        await insertProfile(pendingUser, $('auth-name').value, currentRole, $('auth-birth-date').value);
        const data = ensure(await client.auth.getSession());
        await hydrate(data.session);
      }
    } catch (error) { message(friendly(error), true, 'auth-feedback'); }
    finally { authBusy = false; $('auth-submit').disabled = false; }
  }

  async function signOut() {
    if (loggingOut) return;
    loggingOut = true;
    recovery = false;
    sessionStorage.removeItem('medsafe-recovery');
    history.replaceState(null, '', location.pathname);
    // Immediately clear personal UI even if the network is unavailable.
    clearSessionView();
    showMode('signin');
    try { requireClient(); ensure(await client.auth.signOut({scope:'local'})); message('Signed out.', false, 'auth-feedback'); }
    catch (error) {
      // Clear the SDK's local auth entry as well if remote revocation fails.
      localStorage.removeItem('medsafe-auth-session');
      localStorage.removeItem('medsafe-auth-session-code-verifier');
      sessionStorage.setItem('medsafe-signout-notice', 'Your saved login was cleared on this device. Server sign-out could not be confirmed while offline.');
      // Reload also disposes of SDK memory and any in-flight refresh timers.
      location.replace(location.origin + location.pathname);
    }
    finally { loggingOut = false; }
  }

  async function mutate(operation, success, after) {
    if (mutationBusy) return false;
    if (!signedInId) { message('Sign in before changing records.', true); return false; }
    mutationBusy = true;
    const id = signedInId, stamp = epoch;
    message('Saving…');
    try {
      await operation();
      if (!current(id, stamp)) return false;
      const loaded = await refreshRecords();
      if (!current(id, stamp)) return false;
      if (loaded) { after?.(); message(success); }
      else message('The change was sent, but records could not be reloaded. Refresh before trying the change again.', true);
      return loaded;
    } catch (error) {
      if (current(id, stamp)) {
        await refreshRecords({quiet:true});
        if (current(id, stamp)) message(friendly(error), true);
      }
      return false;
    } finally { mutationBusy = false; }
  }
  function editablePatient(target) {
    if (target === 'patient' && currentRole === 'patient') return currentUser.id;
    const patient = caregiverPatients.find(row => row.id === currentAssignPatientId);
    if (currentRole !== 'caregiver' || !patient?.can_edit) throw new Error('This patient has not granted editing permission.');
    return patient.id;
  }
  function formMedicine(prefix, patientId) {
    const typed = $(prefix + '-med-input').value.trim();
    const name = drugsList.find(value => value.toLowerCase() === typed.toLowerCase());
    if (!name) throw new Error('Choose a medicine from the supported list.');
    const existing = currentRole === 'patient' ? patientMeds : caregiverPatients.find(row => row.id === patientId)?.medicines || [];
    if (existing.some(row => row.name === name)) throw new Error('This medicine is already in the list.');
    const raw = $(prefix + '-med-stock').value.trim();
    const stock = raw === '' ? 30 : Number(raw);
    if (!Number.isInteger(stock) || stock < 0 || stock > 2147483647) throw new Error('Stock must be a whole number of zero or more.');
    const dosage = $(prefix + '-med-dosage').value.trim();
    if (dosage.length > 200) throw new Error('Keep dosage details within 200 characters.');
    return {patient_id:patientId, name, dosage, frequency:$(prefix + '-med-freq').value, stock};
  }
  async function addMedicine(target = 'patient') {
    try {
      const patientId = editablePatient(target);
      const prefix = target === 'patient' ? 'add' : 'assign';
      const record = formMedicine(prefix, patientId);
      await mutate(async()=>ensure(await client.from('medicines').insert(record)), 'Medicine saved.', ()=>{
        for (const suffix of ['input','select','dosage','stock']) $(prefix + '-med-' + suffix).value = '';
        closeAllComboboxes();
      });
    } catch(error) { message(friendly(error), true); }
  }
  async function removeMedicine(index, target = 'patient') {
    try {
      const patientId = editablePatient(target);
      const records = target === 'patient' ? patientMeds : caregiverPatients.find(row=>row.id===patientId).medicines;
      const record = records[index];
      if (!record) return;
      await mutate(async()=>{
        const deleted = ensure(await client.from('medicines').delete().eq('id',record.id).eq('patient_id',patientId).select('id'));
        if (!deleted.length) throw new Error('This record changed or you no longer have permission.');
      }, 'Medicine removed.');
    } catch(error) { message(friendly(error), true); }
  }
  async function saveStock() {
    try {
      const {target, index} = editingStockContext;
      const patientId = editablePatient(target);
      const record = (target === 'patient' ? patientMeds : caregiverPatients.find(row=>row.id===patientId).medicines)[index];
      if (!record) return;
      const raw = $('edit-stock-input').value.trim(), stock = Number(raw);
      if (!raw || !Number.isInteger(stock) || stock < 0 || stock > 2147483647) throw new Error('Stock must be a whole number of zero or more.');
      await mutate(async()=>{
        const updated = ensure(await client.from('medicines').update({stock}).eq('id',record.id).eq('patient_id',patientId).select('id'));
        if (!updated.length) throw new Error('This record changed or you no longer have permission.');
      }, 'Stock saved.', closeEditStockModal);
    } catch(error) { message(friendly(error), true); }
  }
  async function grantAccess(event) {
    event.preventDefault();
    if (currentRole !== 'patient') return;
    const caregiverId = $('caregiver-code').value.trim();
    if (!uuid.test(caregiverId) || caregiverId === signedInId) { message('Paste the code from a different caregiver account.', true); return; }
    const record = {patient_id:signedInId, caregiver_id:caregiverId, can_edit:$('caregiver-edit').checked};
    await mutate(async()=>ensure(await client.from('caregiver_links').insert(record)), 'Caregiver access granted.', ()=>$('caregiver-access-form').reset());
  }
  async function changePermission(caregiverId, canEdit) {
    const patientId = signedInId;
    if (currentRole !== 'patient') return;
    await mutate(async()=>{
      const changed = ensure(await client.from('caregiver_links').update({can_edit:canEdit}).eq('patient_id',patientId).eq('caregiver_id',caregiverId).select('patient_id'));
      if (!changed.length) throw new Error('This connection has changed. Refresh your records.');
    }, canEdit ? 'Editing permission granted.' : 'Caregiver access is now view only.');
  }
  async function revokeAccess(caregiverId, patientId = signedInId) {
    await mutate(async()=>ensure(await client.from('caregiver_links').delete().eq('patient_id',patientId).eq('caregiver_id',caregiverId)), 'Caregiver access removed.');
  }
  async function copyCode() {
    try { await navigator.clipboard.writeText(signedInId || ''); message('Caregiver code copied.'); }
    catch { message('Select the displayed caregiver code and copy it manually.'); }
  }

  function closeProfile(restoreFocus = true) {
    const wasOpen = $('profile-dialog').open;
    $('profile-dialog').close();
    $('profile-form').reset();
    $('profile-email').textContent = '';
    $('profile-role').textContent = '';
    message('', false, 'profile-feedback');
    if (wasOpen && restoreFocus) $('dash-user-pill').focus();
  }
  function openProfile() {
    closeAccountPanel();
    if (!signedInId) return;
    if (mutationBusy) { message('Please wait for your current change to finish.'); return; }
    $('profile-name').value = currentUser.name;
    $('profile-birth-date').value = currentUser.dateOfBirth || '';
    $('profile-birth-date').max = new Date().toLocaleDateString('en-CA');
    $('profile-email').textContent = currentUser.email;
    $('profile-role').textContent = currentRole === 'caregiver' ? 'Caregiver' : 'Patient';
    message('', false, 'profile-feedback');
    $('profile-dialog').showModal();
    $('profile-name').focus();
  }
  function cancelProfile() { if (!profileSaving) closeProfile(); }
  $('profile-dialog').addEventListener('cancel', event=>{event.preventDefault(); cancelProfile();});
  async function saveProfile(event) {
    event.preventDefault();
    if (profileSaving || mutationBusy || !signedInId) return;
    const name = $('profile-name').value.trim();
    const birth = $('profile-birth-date').value;
    if (!name || name.length > 120) { message('Enter a name between 1 and 120 characters.', true, 'profile-feedback'); return; }
    const parsed = birth ? new Date(birth + 'T00:00:00Z') : null;
    if (birth && (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || !Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0,10) !== birth || birth < '1900-01-01' || birth > new Date().toLocaleDateString('en-CA'))) {
      message('Enter a valid date of birth between 1900 and today.', true, 'profile-feedback'); return;
    }
    const id = signedInId, stamp = epoch;
    profileSaving = true;
    mutationBusy = true;
    readSerial += 1; // Do not let an earlier refresh restore the old name.
    for (const field of ['profile-name','profile-birth-date','profile-save','profile-cancel']) $(field).disabled = true;
    message('Saving your profile…', false, 'profile-feedback');
    try {
      const updated = ensure(await client.from('profiles').update({display_name:name, date_of_birth:birth || null}).eq('id', id).select('*'));
      if (!current(id, stamp)) return;
      if (updated.length !== 1) throw new Error('Your profile could not be updated. Sign in again and retry.');
      const own = updated[0];
      profiles = profiles.map(profile=>profile.id === id ? own : profile);
      currentUser.name = own.display_name;
      currentUser.dateOfBirth = own.date_of_birth || '';
      renderAccountIdentity();
      closeProfile();
      message('Profile saved.');
    } catch (error) {
      if (current(id, stamp)) message(friendly(error), true, 'profile-feedback');
    } finally {
      profileSaving = false;
      mutationBusy = false;
      for (const field of ['profile-name','profile-birth-date','profile-save','profile-cancel']) $(field).disabled = false;
    }
  }

  window.MedSafeAccounts = {
    openProfile, closeProfile, cancelProfile, saveProfile,
    showMode, switchMode:()=>showMode(mode === 'signin' ? 'signup' : 'signin'), submitAuth, signOut,
    refresh:()=>refreshRecords(), addMedicine, removeMedicine,
    assignMedicine:()=>addMedicine('caregiver'), removeAssignedMedicine:index=>removeMedicine(index,'caregiver'),
    removePatient:index=>{const patient=caregiverPatients[index]; if(patient) return revokeAccess(signedInId,patient.id);},
    saveStock, grantAccess, copyCode,
  };
  try {
    if (location.protocol === 'file:') throw new Error('Start MedSafe with its launcher to use accounts.');
    if (!window.supabase || !config?.url || !config?.publishableKey?.startsWith('sb_publishable_')) throw new Error('Account connection details are unavailable.');
    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth:{flowType:'pkce', persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storageKey:'medsafe-auth-session'},
      global:{fetch:async(input, options={})=>{
        const timeout = AbortSignal.timeout(15000);
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        return fetch(input,{...options,signal});
      }},
    });
    client.auth.onAuthStateChange((event, session)=>{
      if (loggingOut && event !== 'SIGNED_OUT') return;
      if (event === 'SIGNED_OUT') { clearSessionView(); showMode('signin'); return; }
      if (event === 'PASSWORD_RECOVERY') {
        recovery = true;
        sessionStorage.setItem('medsafe-recovery','true');
        clearSessionView();
        showMode('reset');
        return;
      }
      if (event === 'INITIAL_SESSION' && !session) {
        if (recovery) { showMode('recover'); message('The reset link is invalid or expired. Request a new link.',true,'auth-feedback'); }
        return;
      }
      if (session && (recovery || sessionStorage.getItem('medsafe-recovery') === 'true')) { recovery=true; showMode('reset'); return; }
      if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        // Keep Supabase calls outside the synchronous auth callback's lock.
        setTimeout(()=>hydrate(session),0);
      }
    });
    const error = new URLSearchParams(location.hash.slice(1)).get('error_description');
    if (error) { showMode('signin'); message('The email link could not be used. Request a new link or sign in.',true,'auth-feedback'); history.replaceState(null,'',location.pathname); }
    // Reads re-check database permissions. No browser medicine cache is written.
    const signoutNotice = sessionStorage.getItem('medsafe-signout-notice');
    if (signoutNotice) { sessionStorage.removeItem('medsafe-signout-notice'); showMode('signin'); message(signoutNotice,true,'auth-feedback'); }
    setInterval(()=>{if(signedInId && !mutationBusy && !document.hidden && !$('profile-dialog').open && !$('modal-edit-stock').classList.contains('open') && !$('modal-interaction').classList.contains('open')) refreshRecords({quiet:true});},60000);
  } catch(error) { showMode('signin'); message(friendly(error),true,'auth-feedback'); $('auth-submit').disabled=true; }
})();
