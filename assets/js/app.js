import { listMedicines } from './services/medicine-service.js';
import { getInteractionLevel } from './services/interaction-service.js';
import {
  clearLegacyStorage,
  getAccountStoragePrefix,
  readStoredJson,
  writeStoredJson,
} from './services/storage-service.js';

    let currentRole = 'patient';
    let selectedMedA = null;
    let selectedMedB = null;
    let activeDropdown = null;

    const drugsList = listMedicines();

    function show(id) {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById(id).classList.add('active');
    }

    function goSignIn(role) {
      currentRole = role;
      updateToggle();
      show('screen-signin');
    }

    function goBack() {
      show('screen-role');
    }

    function selectRole(role) {
      currentRole = role;
      updateToggle();
    }

    function updateToggle() {
      document.getElementById('tog-patient').classList.toggle('selected', currentRole === 'patient');
      document.getElementById('tog-caregiver').classList.toggle('selected', currentRole === 'caregiver');
    }

    let currentUser = {
      email: '',
      role: 'patient',
      name: ''
    };

    function handleSignIn(e) {
      e.preventDefault();
      const email = (document.getElementById('email').value || '').trim().toLowerCase();
      const name = email.split('@')[0].replace(/[^a-zA-Z]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || (currentRole === 'patient' ? 'Patient' : 'Caregiver');
      currentUser = {
        email: email,
        role: currentRole,
        name: name
      };
      openDashboard(currentRole, name, email);
    }

    /* ── Dashboard Logic ───────────────────────────────── */
    const patientNav = [
      { id: 'home', label: 'Home' },
      { id: 'medicines', label: 'My Medicines' },
      { id: 'interaction', label: 'Interaction Check' }
    ];
    const caregiverNav = [
      { id: 'home', label: 'Home' },
      { id: 'patients', label: 'Patients' },
      { id: 'assign_meds', label: 'Assign Medicines' },
      { id: 'interaction', label: 'Interaction Check' },
      { id: 'history', label: 'History' }
    ];
    let activeDashPage = 'home';

    // Account-isolated state
    let patientMeds = [];
    let caregiverPatients = [];
    let caregiverMeds = [];

    function getStoragePrefix() {
      return getAccountStoragePrefix(currentUser, currentRole);
    }

    function loadSavedData() {
      clearLegacyStorage();

      if (currentRole === 'patient') {
        patientMeds = readStoredJson(`${getStoragePrefix()}_meds`, []);
        caregiverPatients = [];
        caregiverMeds = [];
      } else {
        caregiverPatients = readStoredJson(`${getStoragePrefix()}_patients`, []).map(p => ({
          ...p,
          id: p.id || ('pt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
          medicines: Array.isArray(p.medicines) ? p.medicines : []
        }));
        caregiverMeds = readStoredJson(`${getStoragePrefix()}_meds`, []);
        patientMeds = [];
      }
    }

    function savePatientMeds() {
      if (currentRole !== 'patient') return;
      writeStoredJson(`${getStoragePrefix()}_meds`, patientMeds);
    }

    function saveCaregiverPatients() {
      if (currentRole !== 'caregiver') return;
      writeStoredJson(`${getStoragePrefix()}_patients`, caregiverPatients);
    }

    function saveCaregiverMeds() {
      if (currentRole !== 'caregiver') return;
      writeStoredJson(`${getStoragePrefix()}_meds`, caregiverMeds);
    }

    /* ── Searchable Medicine Combobox Functions ───────── */
    const comboboxHighlightedIndex = { add: -1, assign: -1 };

    const PENCIL_SVG = '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style="vertical-align:-1px; margin-right:3px;"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.806 2.015 2.015-.806-1.209-1.209z"/></svg>';
    const WARN_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" style="vertical-align:-2px; margin-right:4px;"><path d="M10 2L1 18h18L10 2z" fill="#dc2626"/><path d="M10 8v5M10 15v1" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>';
    const SHIELD_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" style="vertical-align:-2px; margin-right:4px;"><path d="M10 2L3 5v6c0 4.5 3 8 7 9 4-1 7-4.5 7-9V5l-7-3z" fill="#16a34a"/><path d="M7 10l2 2 4-4" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const PILL_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true" style="vertical-align:-1px; margin-right:4px;"><rect x="3" y="7" width="14" height="6" rx="3" fill="#6b7280"/><rect x="3" y="7" width="7" height="6" rx="3" fill="#4b5563"/></svg>';

    function openCombobox(type) {
      closeAllComboboxes();
      const dropdown = document.getElementById(`${type}-med-dropdown`);
      if (!dropdown) return;
      dropdown.classList.add('show');
      const input = document.getElementById(`${type}-med-input`);
      if (input) input.setAttribute('aria-expanded', 'true');
      const query = input ? input.value.trim() : '';
      updateClearButton(type);
      populateComboboxList(type, query);
    }

    function toggleCombobox(type, e) {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      const dropdown = document.getElementById(`${type}-med-dropdown`);
      if (!dropdown) return;
      const isOpen = dropdown.classList.contains('show');
      if (isOpen) {
        dropdown.classList.remove('show');
      } else {
        openCombobox(type);
        const input = document.getElementById(`${type}-med-input`);
        if (input) {
          input.focus();
          input.select();
        }
      }
    }

    function clearCombobox(type, e) {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      const input = document.getElementById(`${type}-med-input`);
      const select = document.getElementById(`${type}-med-select`);
      if (input) {
        input.value = '';
        input.focus();
      }
      if (select) select.value = '';
      updateClearButton(type);
      openCombobox(type);
    }

    function updateClearButton(type) {
      const input = document.getElementById(`${type}-med-input`);
      const clearBtn = document.getElementById(`${type}-med-clear`);
      if (clearBtn) {
        clearBtn.style.display = (input && input.value.trim().length > 0) ? 'flex' : 'none';
      }
    }

    function closeAllComboboxes() {
      document.querySelectorAll('.combobox-dropdown').forEach(d => d.classList.remove('show'));
      document.querySelectorAll('.combobox-search-input').forEach(i => i.setAttribute('aria-expanded', 'false'));
      comboboxHighlightedIndex.add = -1;
      comboboxHighlightedIndex.assign = -1;
    }

    function handleComboboxInput(type) {
      const dropdown = document.getElementById(`${type}-med-dropdown`);
      if (dropdown && !dropdown.classList.contains('show')) {
        dropdown.classList.add('show');
      }
      const input = document.getElementById(`${type}-med-input`);
      const val = input ? input.value.trim() : '';
      updateClearButton(type);

      const select = document.getElementById(`${type}-med-select`);
      const exactMatch = drugsList.find(d => d.toLowerCase() === val.toLowerCase());
      if (select) {
        select.value = exactMatch || '';
      }
      comboboxHighlightedIndex[type] = -1;
      populateComboboxList(type, val);
    }

    function handleComboboxKeydown(type, e) {
      const listEl = document.getElementById(`${type}-med-list`);
      if (!listEl) return;
      const options = Array.from(listEl.querySelectorAll('.combobox-option'));

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const dropdown = document.getElementById(`${type}-med-dropdown`);
        if (!dropdown || !dropdown.classList.contains('show')) {
          openCombobox(type);
          return;
        }
        if (options.length === 0) return;
        comboboxHighlightedIndex[type] = (comboboxHighlightedIndex[type] + 1) % options.length;
        updateComboboxHighlight(type, options);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (options.length === 0) return;
        comboboxHighlightedIndex[type] = (comboboxHighlightedIndex[type] - 1 + options.length) % options.length;
        updateComboboxHighlight(type, options);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (options.length === 0) return;
        const targetOption = comboboxHighlightedIndex[type] >= 0
          ? options[comboboxHighlightedIndex[type]]
          : options[0];
        if (targetOption) {
          targetOption.dispatchEvent(new MouseEvent('mousedown'));
        }
      } else if (e.key === 'Escape') {
        closeAllComboboxes();
      }
    }

    function updateComboboxHighlight(type, options) {
      options.forEach((opt, idx) => {
        if (idx === comboboxHighlightedIndex[type]) {
          opt.classList.add('highlighted');
          opt.scrollIntoView({ block: 'nearest' });
        } else {
          opt.classList.remove('highlighted');
        }
      });
    }

    function populateComboboxList(type, query) {
      const listEl = document.getElementById(`${type}-med-list`);
      const countEl = document.getElementById(`${type}-med-count`);
      const hintActionEl = document.getElementById(`${type}-med-hint-action`);
      if (!listEl) return;

      listEl.innerHTML = '';

      let filtered = drugsList;
      if (query) {
        const q = query.toLowerCase();
        filtered = drugsList.filter(d => d.toLowerCase().includes(q));
      }

      if (countEl) {
        countEl.textContent = query
          ? `${filtered.length} match${filtered.length !== 1 ? 'es' : ''}`
          : `${drugsList.length} medicines`;
      }

      if (hintActionEl) {
        if (query) {
          hintActionEl.innerHTML = `<button type="button" class="combobox-hint-btn" onmousedown="event.preventDefault(); clearCombobox('${type}', event);">Show all ${drugsList.length}</button>`;
        } else {
          hintActionEl.innerHTML = `<span style="font-size:11px; color:#9ca3af;">Scroll or type to search</span>`;
        }
      }

      if (filtered.length === 0) {
        const li = document.createElement('li');
        li.className = 'combobox-no-results';
        li.textContent = `No supported medicines found matching "${query}"`;
        listEl.appendChild(li);
        return;
      }

      const input = document.getElementById(`${type}-med-input`);
      const currentVal = input ? input.value.trim().toLowerCase() : '';

      const displayCount = query ? Math.min(filtered.length, 120) : Math.min(filtered.length, 150);
      const frag = document.createDocumentFragment();

      for (let i = 0; i < displayCount; i++) {
        const drug = filtered[i];
        const li = document.createElement('li');
        li.className = 'combobox-option';
        if (drug.toLowerCase() === currentVal) {
          li.classList.add('selected');
        }

        let labelHtml = drug;
        if (query) {
          const idx = drug.toLowerCase().indexOf(query.toLowerCase());
          if (idx !== -1) {
            const before = drug.slice(0, idx);
            const match = drug.slice(idx, idx + query.length);
            const after = drug.slice(idx + query.length);
            labelHtml = `${before}<span class="combobox-match-highlight">${match}</span>${after}`;
          }
        }

        li.innerHTML = `<span>${labelHtml}</span><span style="font-size:11px; opacity:0.6;">Select</span>`;
        li.onmousedown = (e) => {
          e.preventDefault();
          selectComboboxMedicine(type, drug);
        };
        frag.appendChild(li);
      }

      listEl.appendChild(frag);

      if (filtered.length > displayCount) {
        const moreLi = document.createElement('li');
        moreLi.className = 'combobox-no-results';
        moreLi.style.fontSize = '11px';
        moreLi.style.padding = '6px 12px';
        moreLi.textContent = `+${filtered.length - displayCount} more — type to refine search`;
        listEl.appendChild(moreLi);
      }
    }

    function selectComboboxMedicine(type, drugName) {
      const input = document.getElementById(`${type}-med-input`);
      const select = document.getElementById(`${type}-med-select`);
      if (input) input.value = drugName;
      if (select) select.value = drugName;
      updateClearButton(type);
      closeAllComboboxes();

      const dosage = document.getElementById(`${type}-med-dosage`);
      if (dosage) dosage.focus();
    }

    function populateMedicineSelect() {
      populateComboboxList('add', '');
      populateComboboxList('assign', '');
    }

    function addMedicine() {
      const select = document.getElementById('add-med-select');
      const input = document.getElementById('add-med-input');
      const dosageInput = document.getElementById('add-med-dosage');
      const freqSelect = document.getElementById('add-med-freq');
      const stockInput = document.getElementById('add-med-stock');

      let name = (select ? select.value.trim() : '') || (input ? input.value.trim() : '');
      const validDrug = drugsList.find(d => d.toLowerCase() === name.toLowerCase());
      if (validDrug) {
        name = validDrug;
      }

      if (!name || !validDrug) {
        alert('Please search and select a valid medicine from the supported list.');
        if (input) input.focus();
        return;
      }

      const exists = patientMeds.some(m => m.name.toLowerCase() === name.toLowerCase());
      if (exists) {
        alert(`"${name}" is already in your medication list.`);
        return;
      }

      const dosage = dosageInput.value.trim() || 'Standard';
      const frequency = freqSelect.value || '1x daily';
      const stockVal = stockInput.value.trim();
      const stock = stockVal !== '' ? parseInt(stockVal, 10) : 30;

      patientMeds.push({
        name,
        dosage,
        frequency,
        stock: isNaN(stock) ? 30 : stock
      });

      savePatientMeds();

      // Reset fields
      if (input) input.value = '';
      if (select) select.value = '';
      dosageInput.value = '';
      stockInput.value = '';
      closeAllComboboxes();

      renderDashboard();
    }

    function removeMedicine(index) {
      if (index >= 0 && index < patientMeds.length) {
        patientMeds.splice(index, 1);
        savePatientMeds();
        renderDashboard();
      }
    }

    function addPatient() {
      const nameInput = document.getElementById('add-pt-name');
      const ageInput = document.getElementById('add-pt-age');

      const name = nameInput.value.trim();
      if (!name) {
        alert('Please enter a patient name.');
        nameInput.focus();
        return;
      }

      const ageVal = ageInput.value.trim();
      const age = ageVal !== '' ? parseInt(ageVal, 10) : 65;

      const newPt = {
        id: 'pt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        name,
        age: isNaN(age) ? 65 : age,
        medicines: [],
        lastCheck: 'Today',
        status: 'Healthy'
      };

      caregiverPatients.push(newPt);
      currentAssignPatientId = newPt.id;
      saveCaregiverPatients();

      // Reset fields
      nameInput.value = '';
      ageInput.value = '';

      renderDashboard();
    }

    function removePatient(index) {
      if (index >= 0 && index < caregiverPatients.length) {
        caregiverPatients.splice(index, 1);
        saveCaregiverPatients();
        renderDashboard();
      }
    }

    function evaluatePatientInteractions() {
      const detected = [];
      if (patientMeds.length >= 2) {
        for (let i = 0; i < patientMeds.length; i++) {
          for (let j = i + 1; j < patientMeds.length; j++) {
            const medA = patientMeds[i].name;
            const medB = patientMeds[j].name;
            const level = getInteractionLevel(medA, medB);
            if (level) {
              detected.push({ medA, medB, level });
            }
          }
        }
      }

      const order = { Major: 1, Moderate: 2, Minor: 3 };
      detected.sort((a, b) => (order[a.level] || 99) - (order[b.level] || 99));
      return detected;
    }

    function inspectInteraction(medA, medB) {
      openInteractionModal();
      chooseMedicine('a', medA);
      chooseMedicine('b', medB);
    }

    function renderInteractionsPanel(containerId, interactions) {
      const container = document.getElementById(containerId);
      if (!container) return;

      if (patientMeds.length < 2) {
        if (patientMeds.length === 1) {
          container.innerHTML = `
            <div class="dash-ix-header">
              <div class="dash-ix-heading">Drug-Drug Interactions</div>
            </div>
            <div style="font-size:13.5px; color:#6b7280; padding:12px 16px; background:#f9fafb; border-radius:10px; border:1px solid #e5e7eb;">
              ℹ️ You have 1 medication listed. Add another medication to automatically scan for potential drug interactions.
            </div>
          `;
        } else {
          container.innerHTML = '';
        }
        return;
      }

      let html = `
        <div class="dash-ix-header">
          <div class="dash-ix-heading">
            ${interactions.length > 0 ? `${WARN_ICON_SVG} Detected Drug Interactions` : `${SHIELD_ICON_SVG} Drug Interaction Analysis`}
            <span style="font-size:12px; font-weight:600; padding:2px 8px; border-radius:12px; background:${interactions.length > 0 ? '#fee2e2; color:#b91c1c' : '#dcfce7; color:#15803d'}">
              ${interactions.length} detected
            </span>
          </div>
        </div>
      `;

      if (interactions.length === 0) {
        html += `
          <div class="dash-ix-item ix-Safe">
            <span class="dash-ix-badge">Reference check</span>
            <div class="dash-ix-content">
              <div class="dash-ix-drugs">No Listed Reference Match</div>
              <div class="dash-ix-desc">
                The local reference catalog has no Major, Moderate, or Minor entry for these ${patientMeds.length} medicines. This does not confirm that the combination is safe; consult a qualified clinician or pharmacist.
              </div>
            </div>
          </div>
        `;
      } else {
        interactions.forEach(ix => {
          const desc = `The local reference catalog lists this pair at ${ix.level} severity. Review it with a qualified clinician or pharmacist; this application does not provide treatment instructions.`;

          html += `
            <div class="dash-ix-item ix-${ix.level}">
              <span class="dash-ix-badge">${ix.level}</span>
              <div class="dash-ix-content">
                <div class="dash-ix-drugs">${ix.medA} + ${ix.medB}</div>
                <div class="dash-ix-desc">${desc}</div>
                <button type="button" class="dash-ix-btn" onclick="inspectInteraction('${ix.medA.replace(/'/g, "\\'")}', '${ix.medB.replace(/'/g, "\\'")}')">
                  Open in Interaction Checker →
                </button>
              </div>
            </div>
          `;
        });
      }

      container.innerHTML = html;
    }

    function renderPatientTables() {
      const homeEmpty = document.getElementById('patient-home-empty');
      const homeTable = document.getElementById('patient-home-table');
      const homeTbody = document.getElementById('patient-home-tbody');

      const medEmpty = document.getElementById('med-page-empty');
      const medTable = document.getElementById('med-page-table');
      const medTbody = document.getElementById('med-page-tbody');

      if (patientMeds.length === 0) {
        if (homeEmpty) homeEmpty.style.display = 'block';
        if (homeTable) homeTable.style.display = 'none';
        if (medEmpty) medEmpty.style.display = 'block';
        if (medTable) medTable.style.display = 'none';
        return;
      }

      if (homeEmpty) homeEmpty.style.display = 'none';
      if (homeTable) homeTable.style.display = 'table';
      if (medEmpty) medEmpty.style.display = 'none';
      if (medTable) medTable.style.display = 'table';

      let homeRows = '';
      patientMeds.forEach((m, idx) => {
        const isLow = m.stock <= 10;
        const fillClass = isLow ? 'low' : 'ok';
        const badgeClass = isLow ? 'low-stock' : 'ok';
        const badgeText = isLow ? 'Low Stock' : 'In Stock';
        const pct = Math.min(100, Math.max(5, (m.stock / 50) * 100));

        homeRows += `
          <tr>
            <td><strong>${m.name}</strong></td>
            <td>${m.dosage}</td>
            <td>${m.frequency}</td>
            <td>
              <div class="stock-cell-wrap" onclick="openEditStockModal('patient', ${idx})" title="Click to edit stock count">
                <div class="stock-bar-wrap">
                  <div class="stock-bar"><div class="stock-bar-fill ${fillClass}" style="width:${pct}%"></div></div>
                  <span class="stock-text">${m.stock} left</span>
                </div>
                <button type="button" class="stock-inline-edit-icon" title="Edit stock" aria-label="Edit stock for ${m.name}">${PENCIL_SVG}</button>
              </div>
            </td>
            <td><span class="status-badge ${badgeClass}">${badgeText}</span></td>
          </tr>
        `;
      });
      if (homeTbody) homeTbody.innerHTML = homeRows;

      let medRows = '';
      patientMeds.forEach((m, idx) => {
        const isLow = m.stock <= 10;
        const fillClass = isLow ? 'low' : 'ok';
        const badgeClass = isLow ? 'low-stock' : 'ok';
        const badgeText = isLow ? 'Low Stock' : 'In Stock';
        const pct = Math.min(100, Math.max(5, (m.stock / 50) * 100));

        medRows += `
          <tr>
            <td><strong>${m.name}</strong></td>
            <td>${m.dosage}</td>
            <td>${m.frequency}</td>
            <td>
              <div class="stock-cell-wrap" onclick="openEditStockModal('patient', ${idx})" title="Click to edit stock count">
                <div class="stock-bar-wrap">
                  <div class="stock-bar"><div class="stock-bar-fill ${fillClass}" style="width:${pct}%"></div></div>
                  <span class="stock-text">${m.stock} left</span>
                </div>
                <button type="button" class="stock-inline-edit-icon" title="Edit stock" aria-label="Edit stock for ${m.name}">${PENCIL_SVG}</button>
              </div>
            </td>
            <td><span class="status-badge ${badgeClass}">${badgeText}</span></td>
            <td style="text-align:right; white-space:nowrap;">
              <button type="button" class="edit-stock-btn" onclick="openEditStockModal('patient', ${idx})" title="Edit medicine stock" aria-label="Edit stock for ${m.name}">${PENCIL_SVG}Edit Stock</button>
              <button type="button" class="dash-remove-btn" onclick="removeMedicine(${idx})" title="Remove medicine" aria-label="Remove ${m.name}">✕</button>
            </td>
          </tr>
        `;
      });
      if (medTbody) medTbody.innerHTML = medRows;
    }

    function renderCaregiverTables() {
      const cgHomeEmpty = document.getElementById('caregiver-home-empty');
      const cgHomeTable = document.getElementById('caregiver-home-table');
      const cgHomeTbody = document.getElementById('caregiver-home-tbody');

      const ptEmpty = document.getElementById('pt-page-empty');
      const ptTable = document.getElementById('pt-page-table');
      const ptTbody = document.getElementById('pt-page-tbody');

      if (caregiverPatients.length === 0) {
        if (cgHomeEmpty) cgHomeEmpty.style.display = 'block';
        if (cgHomeTable) cgHomeTable.style.display = 'none';
        if (ptEmpty) ptEmpty.style.display = 'block';
        if (ptTable) ptTable.style.display = 'none';
        return;
      }

      if (cgHomeEmpty) cgHomeEmpty.style.display = 'none';
      if (cgHomeTable) cgHomeTable.style.display = 'table';
      if (ptEmpty) ptEmpty.style.display = 'none';
      if (ptTable) ptTable.style.display = 'table';

      let homeRows = '';
      caregiverPatients.forEach((p) => {
        const medCount = Array.isArray(p.medicines) ? p.medicines.length : (typeof p.medicines === 'number' ? p.medicines : 0);
        homeRows += `
          <tr>
            <td><strong>${p.name}</strong> (${p.age} yrs)</td>
            <td><a href="javascript:void(0)" onclick="goToAssignPatient('${p.id}')" style="color:#2563eb; font-weight:600; text-decoration:none;">${medCount} med${medCount !== 1 ? 's' : ''} →</a></td>
            <td>${p.lastCheck}</td>
            <td><span class="status-badge ok">${p.status}</span></td>
          </tr>
        `;
      });
      if (cgHomeTbody) cgHomeTbody.innerHTML = homeRows;

      let ptRows = '';
      caregiverPatients.forEach((p, idx) => {
        const medCount = Array.isArray(p.medicines) ? p.medicines.length : (typeof p.medicines === 'number' ? p.medicines : 0);
        ptRows += `
          <tr>
            <td><strong>${p.name}</strong> (${p.age} yrs)</td>
            <td><a href="javascript:void(0)" onclick="goToAssignPatient('${p.id}')" style="color:#2563eb; font-weight:600; text-decoration:none;">${medCount} med${medCount !== 1 ? 's' : ''} →</a></td>
            <td>${p.lastCheck}</td>
            <td><span class="status-badge ok">${p.status}</span></td>
            <td style="text-align:right">
              <button type="button" class="dash-add-btn" style="padding:4px 10px; font-size:11px; margin-right:8px;" onclick="goToAssignPatient('${p.id}')">Assign Meds</button>
              <button type="button" class="dash-remove-btn" onclick="removePatient(${idx})" title="Remove patient" aria-label="Remove patient ${p.name}">✕</button>
            </td>
          </tr>
        `;
      });
      if (ptTbody) ptTbody.innerHTML = ptRows;
    }

    let currentAssignPatientId = null;

    function goToAssignPatient(patientId) {
      currentAssignPatientId = patientId;
      dashNavTo('assign_meds');
    }

    function renderAssignMedsPage() {
      const noPtsEl = document.getElementById('assign-meds-no-patients');
      const contentEl = document.getElementById('assign-meds-content');
      if (!noPtsEl || !contentEl) return;

      if (!caregiverPatients || caregiverPatients.length === 0) {
        noPtsEl.style.display = 'block';
        contentEl.style.display = 'none';
        currentAssignPatientId = null;
        return;
      }

      noPtsEl.style.display = 'none';
      contentEl.style.display = 'block';

      // Ensure valid currentAssignPatientId
      const patientExists = caregiverPatients.some(p => p.id === currentAssignPatientId);
      if (!currentAssignPatientId || !patientExists) {
        currentAssignPatientId = caregiverPatients[0].id;
      }

      // Populate patient selector dropdown
      const select = document.getElementById('assign-patient-select');
      if (select) {
        select.innerHTML = '';
        caregiverPatients.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id;
          const count = Array.isArray(p.medicines) ? p.medicines.length : 0;
          opt.textContent = `${p.name} (${p.age} yrs - ${count} med${count !== 1 ? 's' : ''})`;
          if (p.id === currentAssignPatientId) opt.selected = true;
          select.appendChild(opt);
        });
      }

      renderSelectedPatientMeds();
    }

    function onAssignPatientSelectChange() {
      const select = document.getElementById('assign-patient-select');
      if (select) {
        currentAssignPatientId = select.value;
        renderSelectedPatientMeds();
      }
    }

    function renderSelectedPatientMeds() {
      const pt = caregiverPatients.find(p => p.id === currentAssignPatientId);
      if (!pt) return;

      const summary = document.getElementById('assign-patient-summary');
      if (summary) {
        summary.innerHTML = `Managing medications for <strong>${pt.name}</strong> (${pt.age} yrs old)`;
      }

      const emptyEl = document.getElementById('assign-patient-meds-empty');
      const emptyText = document.getElementById('assign-patient-meds-empty-text');
      const tableEl = document.getElementById('assign-patient-meds-table');
      const tbodyEl = document.getElementById('assign-patient-meds-tbody');
      const meds = Array.isArray(pt.medicines) ? pt.medicines : [];

      if (meds.length === 0) {
        if (emptyEl) emptyEl.style.display = 'block';
        if (emptyText) emptyText.innerHTML = `No medications assigned to <strong>${pt.name}</strong> yet. Use the form above to assign medications.`;
        if (tableEl) tableEl.style.display = 'none';
      } else {
        if (emptyEl) emptyEl.style.display = 'none';
        if (tableEl) tableEl.style.display = 'table';

        let rows = '';
        meds.forEach((m, idx) => {
          const isLow = m.stock <= 10;
          const fillClass = isLow ? 'low' : 'ok';
          const badgeClass = isLow ? 'low-stock' : 'ok';
          const badgeText = isLow ? 'Low Stock' : 'In Stock';
          const pct = Math.min(100, Math.max(5, (m.stock / 50) * 100));

          rows += `
            <tr>
              <td><strong>${m.name}</strong></td>
              <td>${m.dosage}</td>
              <td>${m.frequency}</td>
              <td>
                <div class="stock-cell-wrap" onclick="openEditStockModal('caregiver', ${idx})" title="Click to edit stock count">
                  <div class="stock-bar-wrap">
                    <div class="stock-bar"><div class="stock-bar-fill ${fillClass}" style="width:${pct}%"></div></div>
                    <span class="stock-text">${m.stock} left</span>
                  </div>
                  <button type="button" class="stock-inline-edit-icon" title="Edit stock" aria-label="Edit stock for ${m.name}">${PENCIL_SVG}</button>
                </div>
              </td>
              <td><span class="status-badge ${badgeClass}">${badgeText}</span></td>
              <td style="text-align:right; white-space:nowrap;">
                <button type="button" class="edit-stock-btn" onclick="openEditStockModal('caregiver', ${idx})" title="Edit medicine stock" aria-label="Edit stock for ${m.name}">${PENCIL_SVG}Edit Stock</button>
                <button type="button" class="dash-remove-btn" onclick="removeAssignedMedicine(${idx})" title="Remove assigned medicine" aria-label="Remove assigned medicine ${m.name}">✕</button>
              </td>
            </tr>
          `;
        });
        if (tbodyEl) tbodyEl.innerHTML = rows;
      }

      // Check interactions among this patient's assigned medicines
      const ptInteractions = [];
      if (meds.length >= 2) {
        for (let i = 0; i < meds.length; i++) {
          for (let j = i + 1; j < meds.length; j++) {
            const level = getInteractionLevel(meds[i].name, meds[j].name);
            if (level) {
              ptInteractions.push({ medA: meds[i].name, medB: meds[j].name, level });
            }
          }
        }
      }
      const order = { Major: 1, Moderate: 2, Minor: 3 };
      ptInteractions.sort((a, b) => (order[a.level] || 99) - (order[b.level] || 99));

      renderPatientAssignInteractions(pt.name, meds.length, ptInteractions);
    }

    function renderPatientAssignInteractions(patientName, medCount, interactions) {
      const container = document.getElementById('assign-patient-interactions');
      if (!container) return;

      if (medCount < 2) {
        if (medCount === 1) {
          container.innerHTML = `
            <div class="dash-ix-header">
              <div class="dash-ix-heading">Drug Interaction Analysis</div>
            </div>
            <div style="font-size:13.5px; color:#6b7280; padding:12px 16px; background:#f9fafb; border-radius:10px; border:1px solid #e5e7eb;">
              ℹ️ 1 medication assigned to ${patientName}. Assign at least 2 medications to automatically scan for interactions.
            </div>
          `;
        } else {
          container.innerHTML = '';
        }
        return;
      }

      let html = `
        <div class="dash-ix-header">
          <div class="dash-ix-heading">
            ${interactions.length > 0 ? `${WARN_ICON_SVG} Detected Drug Interactions for ${patientName}` : `${SHIELD_ICON_SVG} Drug Interaction Analysis for ${patientName}`}
            <span style="font-size:12px; font-weight:600; padding:2px 8px; border-radius:12px; background:${interactions.length > 0 ? '#fee2e2; color:#b91c1c' : '#dcfce7; color:#15803d'}">
              ${interactions.length} detected
            </span>
          </div>
        </div>
      `;

      if (interactions.length === 0) {
        html += `
          <div class="dash-ix-item ix-Safe">
            <span class="dash-ix-badge">Reference check</span>
            <div class="dash-ix-content">
              <div class="dash-ix-drugs">No Listed Reference Match</div>
              <div class="dash-ix-desc">
                The local reference catalog has no Major, Moderate, or Minor entry for these assigned medicines. This does not confirm that the combination is safe.
              </div>
            </div>
          </div>
        `;
      } else {
        interactions.forEach(ix => {
          const desc = `The local reference catalog lists this pair at ${ix.level} severity. Review it with a qualified clinician or pharmacist.`;

          html += `
            <div class="dash-ix-item ix-${ix.level}">
              <span class="dash-ix-badge">${ix.level}</span>
              <div class="dash-ix-content">
                <div class="dash-ix-drugs">${ix.medA} + ${ix.medB}</div>
                <div class="dash-ix-desc">${desc}</div>
                <button type="button" class="dash-ix-btn" onclick="openInteractionModal('${ix.medA.replace(/'/g, "\\'")}', '${ix.medB.replace(/'/g, "\\'")}')">
                  Open in Interaction Checker →
                </button>
              </div>
            </div>
          `;
        });
      }

      container.innerHTML = html;
    }

    function assignMedicineToPatient() {
      const pt = caregiverPatients.find(p => p.id === currentAssignPatientId);
      if (!pt) {
        alert('Please select a patient first.');
        return;
      }

      const select = document.getElementById('assign-med-select');
      const input = document.getElementById('assign-med-input');
      const dosageInput = document.getElementById('assign-med-dosage');
      const freqSelect = document.getElementById('assign-med-freq');
      const stockInput = document.getElementById('assign-med-stock');

      let name = (select ? select.value.trim() : '') || (input ? input.value.trim() : '');
      const validDrug = drugsList.find(d => d.toLowerCase() === name.toLowerCase());
      if (validDrug) {
        name = validDrug;
      }

      if (!name || !validDrug) {
        alert('Please search and select a valid medication from the supported list.');
        if (input) input.focus();
        return;
      }

      if (!Array.isArray(pt.medicines)) pt.medicines = [];

      const exists = pt.medicines.some(m => m.name.toLowerCase() === name.toLowerCase());
      if (exists) {
        alert(`"${name}" is already assigned to ${pt.name}.`);
        return;
      }

      const dosage = dosageInput.value.trim() || 'Standard';
      const frequency = freqSelect.value || '1x daily';
      const stockVal = stockInput.value.trim();
      const stock = stockVal !== '' ? parseInt(stockVal, 10) : 30;

      pt.medicines.push({
        name,
        dosage,
        frequency,
        stock: isNaN(stock) ? 30 : stock
      });
      pt.lastCheck = 'Today';

      saveCaregiverPatients();

      // Reset fields
      if (input) input.value = '';
      if (select) select.value = '';
      dosageInput.value = '';
      stockInput.value = '';
      closeAllComboboxes();

      renderDashboard();
      renderAssignMedsPage();
    }

    function removeAssignedMedicine(index) {
      const pt = caregiverPatients.find(p => p.id === currentAssignPatientId);
      if (!pt || !Array.isArray(pt.medicines)) return;

      if (index >= 0 && index < pt.medicines.length) {
        pt.medicines.splice(index, 1);
        saveCaregiverPatients();
        renderDashboard();
        renderAssignMedsPage();
      }
    }

    function renderSidebarInteractionAlerts(interactions) {
      // Update nav badge on Interaction Check button in dash-sidebar
      const navBtn = document.querySelector('.dash-nav-item[data-page="interaction"]');
      if (navBtn) {
        const existingBadge = navBtn.querySelector('.dash-nav-badge');
        if (existingBadge) existingBadge.remove();

        if (currentRole === 'patient') {
          if (interactions.length > 0) {
            const badge = document.createElement('span');
            badge.className = 'dash-nav-badge badge-danger';
            badge.textContent = `${interactions.length} detected`;
            navBtn.appendChild(badge);
          } else if (patientMeds.length >= 2) {
            const badge = document.createElement('span');
            badge.className = 'dash-nav-badge badge-safe';
            badge.textContent = 'Reference check';
            navBtn.appendChild(badge);
          }
        }
      }

      // Update sidebar widget in dash-sidebar
      const widget = document.getElementById('dash-sidebar-interaction-widget');
      if (!widget) return;

      if (currentRole === 'patient') {
        if (interactions.length > 0) {
          const topIx = interactions[0];
          widget.innerHTML = `
            <div class="dash-sidebar-widget-card widget-danger" onclick="dashNavTo('interaction')">
              <div class="dash-sidebar-widget-header">
                ${WARN_ICON_SVG}
                <strong>${interactions.length} Interaction${interactions.length > 1 ? 's' : ''}</strong>
              </div>
              <div class="dash-sidebar-widget-text">
                ${topIx.medA} + ${topIx.medB} (${topIx.level})
                ${interactions.length > 1 ? `<br><span style="opacity:0.8">+${interactions.length - 1} other pair</span>` : ''}
              </div>
              <div class="dash-sidebar-widget-link">Open Interaction Check →</div>
            </div>
          `;
          widget.style.display = 'block';
        } else if (patientMeds.length >= 2) {
          widget.innerHTML = `
            <div class="dash-sidebar-widget-card widget-safe" onclick="dashNavTo('interaction')">
              <div class="dash-sidebar-widget-header">
                ${SHIELD_ICON_SVG}
                <strong>Reference check complete</strong>
              </div>
              <div class="dash-sidebar-widget-text">No listed reference match for ${patientMeds.length} medications. This does not confirm safety.</div>
            </div>
          `;
          widget.style.display = 'block';
        } else {
          widget.innerHTML = '';
          widget.style.display = 'none';
        }
      } else {
        widget.innerHTML = '';
        widget.style.display = 'none';
      }
    }

    function renderModalSidebar(interactions) {
      const section = document.getElementById('ic-sidebar-patient-section');
      if (!section) return;

      if (currentRole !== 'patient') {
        section.innerHTML = `
          <div style="font-size:11.5px; color:#6b7280; line-height:1.4;">
            Caregiver mode. Use the dropdowns to check drug interactions for any medications.
          </div>
        `;
        return;
      }

      if (patientMeds.length === 0) {
        section.innerHTML = `
          <div class="ic-sidebar-section-title">My Medications</div>
          <div style="font-size:11.5px; color:#9ca3af; line-height:1.4;">
            No medications added yet. Add medications in My Medicines to enable automatic interaction checking.
          </div>
        `;
        return;
      }

      let html = `
        <div>
          <div class="ic-sidebar-section-title">My Medications (${patientMeds.length})</div>
          <div class="ic-sidebar-med-chip-list">
      `;

      patientMeds.forEach(m => {
        html += `
          <div class="ic-sidebar-med-chip" onclick="quickSelectChip('${m.name.replace(/'/g, "\\'")}')" title="Click to inspect ${m.name}">
            <span>${PILL_ICON_SVG} ${m.name}</span>
            <span style="font-size:10px; color:#4b5563;">Use</span>
          </div>
        `;
      });

      html += `
          </div>
        </div>
        <div>
          <div class="ic-sidebar-section-title">Interaction Status</div>
      `;

      if (interactions.length > 0) {
        interactions.forEach(ix => {
          html += `
            <div class="ic-sidebar-alert-card alert-${ix.level}" onclick="inspectInteraction('${ix.medA.replace(/'/g, "\\'")}', '${ix.medB.replace(/'/g, "\\'")}')" title="Click to view full analysis">
              <span class="ic-sidebar-alert-badge">${ix.level} Risk</span>
              <div class="ic-sidebar-alert-pair">${ix.medA} + ${ix.medB}</div>
              <div class="ic-sidebar-alert-hint">Click to inspect ↗</div>
            </div>
          `;
        });
      } else if (patientMeds.length >= 2) {
        html += `
          <div class="ic-sidebar-alert-card alert-Safe">
            <span class="ic-sidebar-alert-badge">Reference check</span>
            <div class="ic-sidebar-alert-pair">No Listed Reference Match</div>
            <div class="ic-sidebar-alert-hint">This does not confirm that ${patientMeds.length} medications are safe together.</div>
          </div>
        `;
      } else {
        html += `
          <div style="font-size:11px; color:#9ca3af;">
            Add at least 2 medications to monitor interactions.
          </div>
        `;
      }

      html += `</div>`;
      section.innerHTML = html;
    }

    function quickSelectChip(drugName) {
      if (!selectedMedA || (selectedMedA && selectedMedB)) {
        selectedMedA = null;
        selectedMedB = null;
        chooseMedicine('a', drugName);
      } else {
        chooseMedicine('b', drugName);
      }
    }

    function renderDashboard() {
      const isPatient = (currentRole === 'patient');

      const labelFirst = document.getElementById('stat-label-first');
      if (labelFirst) {
        labelFirst.textContent = isPatient ? 'MEDICINES' : 'PATIENTS';
      }

      if (isPatient) {
        const interactions = evaluatePatientInteractions();
        const lowStockMeds = patientMeds.filter(m => m.stock <= 10);

        document.getElementById('stat-patients').textContent = patientMeds.length;
        document.getElementById('stat-low-stock').textContent = lowStockMeds.length;
        document.getElementById('stat-checks').textContent = interactions.length;

        const alertBanner = document.getElementById('dash-alert-banner');
        const alertText = document.getElementById('dash-alert-text');
        if (lowStockMeds.length > 0) {
          alertBanner.classList.remove('hidden');
          alertText.innerHTML = `${WARN_ICON_SVG} Low stock: <strong>${lowStockMeds.length}</strong> medicine${lowStockMeds.length > 1 ? 's' : ''} (${lowStockMeds.map(m => m.name).join(', ')}) running low`;
        } else {
          alertBanner.classList.add('hidden');
        }

        renderPatientTables();
        renderInteractionsPanel('dash-home-interactions', interactions);
        renderInteractionsPanel('dash-med-interactions', interactions);
        renderInteractionsPanel('dash-interaction-page-results', interactions);
        renderSidebarInteractionAlerts(interactions);
        renderModalSidebar(interactions);

      } else {
        let totalAssignedMeds = 0;
        let totalLowStock = 0;
        let totalInteractions = 0;

        caregiverPatients.forEach(p => {
          if (Array.isArray(p.medicines)) {
            totalAssignedMeds += p.medicines.length;
            totalLowStock += p.medicines.filter(m => m.stock <= 10).length;
            if (p.medicines.length >= 2) {
              for (let i = 0; i < p.medicines.length; i++) {
                for (let j = i + 1; j < p.medicines.length; j++) {
                  if (getInteractionLevel(p.medicines[i].name, p.medicines[j].name)) totalInteractions++;
                }
              }
            }
          }
        });

        document.getElementById('stat-patients').textContent = caregiverPatients.length;
        document.getElementById('stat-low-stock').textContent = totalLowStock;
        document.getElementById('stat-checks').textContent = totalInteractions;

        const alertBanner = document.getElementById('dash-alert-banner');
        const alertText = document.getElementById('dash-alert-text');
        if (totalLowStock > 0) {
          alertBanner.classList.remove('hidden');
          alertText.innerHTML = `${WARN_ICON_SVG} Low stock: <strong>${totalLowStock}</strong> medication${totalLowStock > 1 ? 's' : ''} running low across your patients`;
        } else {
          alertBanner.classList.add('hidden');
        }

        renderCaregiverTables();
        renderAssignMedsPage();
        renderSidebarInteractionAlerts([]);
        renderModalSidebar([]);
      }
    }

    function openDashboard(role, userName, email) {
      currentRole = role;
      if (email) {
        currentUser.email = email.trim().toLowerCase();
        currentUser.role = role;
        currentUser.name = userName;
      }
      const overlay = document.getElementById('dashboard-overlay');
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';

      // Set user name
      document.getElementById('dash-user-pill').textContent = userName + ' ▾';

      // Greeting based on time of day
      const hour = new Date().getHours();
      let greeting = 'Good morning';
      if (hour >= 12 && hour < 18) greeting = 'Good afternoon';
      else if (hour >= 18) greeting = 'Good evening';
      document.getElementById('dash-greeting').textContent = `${greeting}, ${userName}`;

      // Build nav
      const navItems = role === 'caregiver' ? caregiverNav : patientNav;
      const navEl = document.getElementById('dash-nav');
      navEl.innerHTML = '';
      navItems.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'dash-nav-item' + (item.id === 'home' ? ' active' : '');
        btn.setAttribute('data-page', item.id);
        btn.innerHTML = `<span>${item.label}</span>`;
        btn.onclick = () => dashNavTo(item.id);
        navEl.appendChild(btn);
      });

      // Show correct home table
      document.getElementById('dash-home-patient-table').style.display = role === 'patient' ? '' : 'none';
      document.getElementById('dash-home-caregiver-table').style.display = role === 'caregiver' ? '' : 'none';

      // View medicines button behavior
      document.getElementById('dash-view-meds-btn').onclick = () => {
        dashNavTo(role === 'caregiver' ? 'assign_meds' : 'medicines');
      };

      // Populate medicine options and load account-scoped data
      populateMedicineSelect();
      loadSavedData();
      renderDashboard();

      activeDashPage = 'home';
      dashNavTo('home');
    }

    function dashNavTo(pageId) {
      activeDashPage = pageId;
      document.querySelectorAll('.dash-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-page') === pageId);
      });
      document.querySelectorAll('.dash-page').forEach(p => p.classList.remove('active'));
      const page = document.getElementById('dash-page-' + pageId);
      if (page) page.classList.add('active');

      const titles = {
        home: 'Home',
        medicines: 'My Medicines',
        patients: 'Patients',
        assign_meds: 'Assign Medicines',
        interaction: 'Interaction Check',
        history: 'History'
      };
      document.getElementById('dash-topbar-title').textContent = titles[pageId] || 'Home';

      if (pageId === 'medicines') {
        populateMedicineSelect();
      }
      if (pageId === 'assign_meds') {
        populateMedicineSelect();
        renderAssignMedsPage();
      }
      if (pageId === 'interaction' && currentRole === 'patient') {
        const interactions = evaluatePatientInteractions();
        renderInteractionsPanel('dash-interaction-page-results', interactions);
      }
    }

    function dashLogout() {
      document.getElementById('dashboard-overlay').classList.remove('open');
      document.body.style.overflow = '';

      // Reset state and clear memory so data never bleeds to next account
      currentUser = { email: '', role: 'patient', name: '' };
      patientMeds = [];
      caregiverPatients = [];
      caregiverMeds = [];

      const emailInput = document.getElementById('email');
      if (emailInput) emailInput.value = '';
      const pwdInput = document.getElementById('password');
      if (pwdInput) pwdInput.value = '';

      // Reset combobox and form inputs
      ['add', 'assign'].forEach(t => {
        const inp = document.getElementById(`${t}-med-input`);
        const sel = document.getElementById(`${t}-med-select`);
        const clr = document.getElementById(`${t}-med-clear`);
        const dos = document.getElementById(`${t}-med-dosage`);
        const stk = document.getElementById(`${t}-med-stock`);
        if (inp) inp.value = '';
        if (sel) sel.value = '';
        if (clr) clr.style.display = 'none';
        if (dos) dos.value = '';
        if (stk) stk.value = '';
      });
      closeAllComboboxes();
      closeEditStockModal();

      show('screen-role');
    }

    /* ── Edit Medicine Stock Modal Functions ──────────── */
    let editingStockContext = { target: null, index: -1 };

    function openEditStockModal(target, index) {
      editingStockContext = { target, index };
      let med = null;
      let patientName = '';

      if (target === 'patient') {
        if (!patientMeds || !patientMeds[index]) return;
        med = patientMeds[index];
        patientName = (currentUser && currentUser.name) ? currentUser.name : 'You';
      } else if (target === 'caregiver') {
        const pt = caregiverPatients.find(p => p.id === currentAssignPatientId);
        if (!pt || !Array.isArray(pt.medicines) || !pt.medicines[index]) return;
        med = pt.medicines[index];
        patientName = pt.name;
      }

      if (!med) return;

      const modal = document.getElementById('modal-edit-stock');
      const titleEl = document.getElementById('edit-stock-title');
      const subtitleEl = document.getElementById('edit-stock-subtitle');
      const nameEl = document.getElementById('edit-stock-med-name');
      const regimenEl = document.getElementById('edit-stock-med-regimen');
      const currentBadgeEl = document.getElementById('edit-stock-current-badge');
      const inputEl = document.getElementById('edit-stock-input');

      if (titleEl) titleEl.textContent = 'Update Stock';
      if (subtitleEl) {
        subtitleEl.textContent = target === 'caregiver'
          ? `Adjust medication inventory for ${patientName}`
          : 'Adjust remaining units in your inventory';
      }
      if (nameEl) nameEl.textContent = med.name;
      if (regimenEl) regimenEl.textContent = `${med.dosage} • ${med.frequency}`;

      const isLow = (med.stock <= 10);
      if (currentBadgeEl) {
        currentBadgeEl.className = `status-badge ${isLow ? 'low-stock' : 'ok'}`;
        currentBadgeEl.textContent = `${isLow ? 'Low Stock' : 'In Stock'} (${med.stock} left)`;
      }

      if (inputEl) {
        inputEl.value = med.stock;
      }
      onStockInputChange();

      if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
      }

      setTimeout(() => {
        if (inputEl) {
          inputEl.focus();
          inputEl.select();
        }
      }, 50);
    }

    function closeEditStockModal() {
      const modal = document.getElementById('modal-edit-stock');
      if (modal) modal.classList.remove('open');
      document.body.style.overflow = '';
      editingStockContext = { target: null, index: -1 };
    }

    function handleEditStockBackdropClick(e) {
      if (e.target.id === 'modal-edit-stock') {
        closeEditStockModal();
      }
    }

    function onStockInputChange() {
      const inputEl = document.getElementById('edit-stock-input');
      const previewBadge = document.getElementById('edit-stock-preview-badge');
      if (!inputEl || !previewBadge) return;

      const val = parseInt(inputEl.value, 10);
      const stock = isNaN(val) ? 0 : Math.max(0, val);
      const isLow = stock <= 10;

      previewBadge.className = `status-badge ${isLow ? 'low-stock' : 'ok'}`;
      previewBadge.textContent = `${isLow ? 'Low Stock' : 'In Stock'} (${stock} units)`;
    }

    function stepStock(delta) {
      const inputEl = document.getElementById('edit-stock-input');
      if (!inputEl) return;
      let val = parseInt(inputEl.value, 10);
      if (isNaN(val)) val = 0;
      val = Math.max(0, val + delta);
      inputEl.value = val;
      onStockInputChange();
    }

    function setStockPreset(val) {
      const inputEl = document.getElementById('edit-stock-input');
      if (!inputEl) return;
      inputEl.value = Math.max(0, val);
      onStockInputChange();
    }

    function addStockPreset(delta) {
      stepStock(delta);
    }

    function saveStockModalChanges() {
      const { target, index } = editingStockContext;
      const inputEl = document.getElementById('edit-stock-input');
      if (!inputEl) return;

      const val = parseInt(inputEl.value, 10);
      if (isNaN(val) || val < 0) {
        alert('Please enter a valid non-negative number for stock.');
        inputEl.focus();
        return;
      }
      const newStock = val;

      if (target === 'patient') {
        if (patientMeds[index]) {
          patientMeds[index].stock = newStock;
          savePatientMeds();
          renderDashboard();
        }
      } else if (target === 'caregiver') {
        const pt = caregiverPatients.find(p => p.id === currentAssignPatientId);
        if (pt && Array.isArray(pt.medicines) && pt.medicines[index]) {
          pt.medicines[index].stock = newStock;
          saveCaregiverPatients();
          renderDashboard();
          renderSelectedPatientMeds();
        }
      }

      closeEditStockModal();
    }

    /* ── Interaction Check Modal Functions ─────────────── */
    function openInteractionModal(medA, medB) {
      const modal = document.getElementById('modal-interaction');
      modal.classList.add('open');
      document.body.style.overflow = 'hidden';

      populateOptions('a', '');
      populateOptions('b', '');

      const isPatient = (currentRole === 'patient');
      const interactions = isPatient ? evaluatePatientInteractions() : [];
      renderModalSidebar(interactions);

      if (medA && medB) {
        chooseMedicine('a', medA);
        chooseMedicine('b', medB);
      } else if (isPatient && interactions.length > 0) {
        // Automatically reflect the first detected interaction between user's inputted medicines
        chooseMedicine('a', interactions[0].medA);
        chooseMedicine('b', interactions[0].medB);
      } else if (isPatient && patientMeds.length >= 2) {
        chooseMedicine('a', patientMeds[0].name);
        chooseMedicine('b', patientMeds[1].name);
      } else if (isPatient && patientMeds.length === 1) {
        chooseMedicine('a', patientMeds[0].name);
      }

      setTimeout(() => {
        const firstFocus = modal.querySelector('button.ic-modal-close-icon, button, input');
        if (firstFocus) firstFocus.focus();
      }, 50);
    }

    function closeInteractionModal() {
      const modal = document.getElementById('modal-interaction');
      modal.classList.remove('open');
      document.body.style.overflow = '';
      closeAllDropdowns();
    }

    function handleBackdropClick(e) {
      if (e.target.id === 'modal-interaction') {
        closeInteractionModal();
      }
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeAllComboboxes();
        closeEditStockModal();
        if (activeDropdown) {
          closeAllDropdowns();
        } else {
          closeInteractionModal();
        }
      }
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.ic-form-group')) {
        closeAllDropdowns();
      }
      if (!e.target.closest('.med-combobox-wrapper')) {
        closeAllComboboxes();
      }
    });

    /* ── Dropdown Select Logic ─────────────────────────── */
    function toggleDropdown(field, e) {
      if (e) e.stopPropagation();
      const menu = document.getElementById(`menu-${field}`);
      const trigger = document.getElementById(`trigger-${field}`);
      const isCurrentlyOpen = menu.classList.contains('show');

      closeAllDropdowns();

      if (!isCurrentlyOpen) {
        menu.classList.add('show');
        trigger.classList.add('active');
        trigger.setAttribute('aria-expanded', 'true');
        activeDropdown = field;
        const searchInput = document.getElementById(`search-${field}`);
        searchInput.value = '';
        populateOptions(field, '');
        setTimeout(() => searchInput.focus(), 50);
      }
    }

    function closeAllDropdowns() {
      document.querySelectorAll('.cs-dropdown-menu').forEach(m => m.classList.remove('show'));
      document.querySelectorAll('.cs-trigger').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-expanded', 'false');
      });
      activeDropdown = null;
    }

    function handleSearch(field) {
      const query = document.getElementById(`search-${field}`).value.trim().toLowerCase();
      populateOptions(field, query);
    }

    function populateOptions(field, query) {
      const listEl = document.getElementById(`list-${field}`);
      listEl.innerHTML = '';

      const otherSelected = field === 'a' ? selectedMedB : selectedMedA;
      const currentSelected = field === 'a' ? selectedMedA : selectedMedB;

      // Filter drugs
      let filtered = drugsList;
      if (query) {
        filtered = drugsList.filter(d => d.toLowerCase().includes(query));
      }

      if (filtered.length === 0) {
        const noRes = document.createElement('li');
        noRes.className = 'cs-no-results';
        noRes.textContent = `No supported medicine found matching "${query}"`;
        listEl.appendChild(noRes);
        return;
      }

      // Render top 100 for fast performance
      const displayCount = Math.min(filtered.length, 100);
      for (let i = 0; i < displayCount; i++) {
        const drug = filtered[i];
        const li = document.createElement('li');
        li.className = 'cs-option';

        const isAlreadyChosen = otherSelected && (drug.toLowerCase() === otherSelected.toLowerCase());
        const isCurrent = currentSelected && (drug.toLowerCase() === currentSelected.toLowerCase());

        if (isCurrent) {
          li.classList.add('selected');
        }

        if (isAlreadyChosen) {
          li.classList.add('disabled');
          li.innerHTML = `<span>${drug}</span><span class="cs-badge-disabled">Selected in Medicine ${field === 'a' ? 'B' : 'A'}</span>`;
          li.onclick = (e) => {
            e.stopPropagation();
            showSameMedAlert();
          };
        } else {
          li.innerHTML = `<span>${drug}</span>`;
          li.onclick = (e) => {
            e.stopPropagation();
            chooseMedicine(field, drug);
          };
        }

        listEl.appendChild(li);
      }
    }

    function chooseMedicine(field, drugName) {
      hideSameMedAlert();

      if (field === 'a') {
        if (selectedMedB && selectedMedB.toLowerCase() === drugName.toLowerCase()) {
          showSameMedAlert();
          return;
        }
        selectedMedA = drugName;
        const textA = document.getElementById('text-a');
        textA.textContent = drugName;
        textA.classList.remove('placeholder');
      } else {
        if (selectedMedA && selectedMedA.toLowerCase() === drugName.toLowerCase()) {
          showSameMedAlert();
          return;
        }
        selectedMedB = drugName;
        const textB = document.getElementById('text-b');
        textB.textContent = drugName;
        textB.classList.remove('placeholder');
      }

      closeAllDropdowns();
      evaluateInteraction();
    }

    function showSameMedAlert() {
      const alertEl = document.getElementById('ic-same-med-alert');
      alertEl.classList.add('show');
    }

    function hideSameMedAlert() {
      const alertEl = document.getElementById('ic-same-med-alert');
      alertEl.classList.remove('show');
    }

    function evaluateInteraction() {
      const resultBox = document.getElementById('ic-result-box');
      const badge = document.getElementById('ic-badge');
      const title = document.getElementById('ic-result-title');
      const desc = document.getElementById('ic-result-desc');

      // Both must be chosen and different
      if (!selectedMedA || !selectedMedB) {
        resultBox.className = 'ic-result-box';
        return;
      }

      if (selectedMedA.toLowerCase() === selectedMedB.toLowerCase()) {
        showSameMedAlert();
        resultBox.className = 'ic-result-box';
        return;
      }

      hideSameMedAlert();

      const level = getInteractionLevel(selectedMedA, selectedMedB);

      resultBox.className = 'ic-result-box show';

      if (level === 'Major') {
        resultBox.classList.add('level-Major');
        badge.textContent = 'Major Interaction';
        title.textContent = `Major reference entry: ${selectedMedA} + ${selectedMedB}`;
        desc.textContent = 'The local reference catalog lists this pair as Major. Review it with a qualified clinician or pharmacist; MedSafe does not provide treatment instructions.';
      } else if (level === 'Moderate') {
        resultBox.classList.add('level-Moderate');
        badge.textContent = 'Moderate Interaction';
        title.textContent = `Moderate Interaction: ${selectedMedA} + ${selectedMedB}`;
        desc.textContent = 'The local reference catalog lists this pair as Moderate. Review it with a qualified clinician or pharmacist; MedSafe does not provide treatment instructions.';
      } else if (level === 'Minor') {
        resultBox.classList.add('level-Minor');
        badge.textContent = 'Minor Interaction';
        title.textContent = `Minor Interaction: ${selectedMedA} + ${selectedMedB}`;
        desc.textContent = 'The local reference catalog lists this pair as Minor. Review it with a qualified clinician or pharmacist; MedSafe does not provide treatment instructions.';
      } else {
        resultBox.classList.add('level-None');
        badge.textContent = 'No Listed Reference Match';
        title.textContent = 'No Listed Reference Match';
        desc.textContent = `The local reference catalog does not list a Major, Moderate, or Minor interaction for ${selectedMedA} and ${selectedMedB}. This is not a confirmation that the combination is safe; consult a qualified clinician or pharmacist.`;
      }
    }

    function resetMedicines() {
      selectedMedA = null;
      selectedMedB = null;

      const textA = document.getElementById('text-a');
      textA.textContent = 'Select medicine';
      textA.classList.add('placeholder');

      const textB = document.getElementById('text-b');
      textB.textContent = 'Select medicine';
      textB.classList.add('placeholder');

      hideSameMedAlert();
      const resultBox = document.getElementById('ic-result-box');
      resultBox.className = 'ic-result-box';
      closeAllDropdowns();
    }

    Object.assign(window, {
      addMedicine, addPatient, addStockPreset, assignMedicineToPatient,
      chooseMedicine, clearCombobox, closeEditStockModal, closeInteractionModal,
      dashLogout, dashNavTo, goBack, goSignIn, goToAssignPatient,
      handleBackdropClick, handleComboboxInput, handleComboboxKeydown,
      handleEditStockBackdropClick, handleSearch, handleSignIn, inspectInteraction,
      onAssignPatientSelectChange, onStockInputChange, openCombobox,
      openEditStockModal, openInteractionModal, quickSelectChip, removeAssignedMedicine,
      removeMedicine, removePatient, resetMedicines, saveStockModalChanges,
      selectRole, setStockPreset, stepStock, toggleCombobox, toggleDropdown,
    });

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./service-worker.js").catch(() => {});
      });
    }
