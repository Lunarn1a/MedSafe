export function getAccountStoragePrefix(user, fallbackRole = 'patient') {
  const email = user && user.email ? user.email.toLowerCase().trim() : 'anonymous';
  const role = user && user.role ? user.role : fallbackRole;
  return `medsafe_${role}_${encodeURIComponent(email)}`;
}

export function readStoredJson(key, fallbackValue) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallbackValue;
  } catch {
    return fallbackValue;
  }
}

export function writeStoredJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function clearLegacyStorage() {
  try {
    localStorage.removeItem('medsafe_patient_meds');
    localStorage.removeItem('medsafe_caregiver_patients');
  } catch {}
}
