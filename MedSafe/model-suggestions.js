/* Connect reference findings to the local, experimental suggestion selector. */
(() => {
  'use strict';

  const panel = document.getElementById('ic-model-suggestions');
  let controller = null;
  let requestId = 0;

  function clear() {
    requestId += 1;
    if (controller) controller.abort();
    controller = null;
    panel.replaceChildren();
    panel.hidden = true;
  }

  function paragraph(text, className = '') {
    const element = document.createElement('p');
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function showMessage(text) {
    panel.hidden = false;
    panel.replaceChildren(paragraph(text, 'ic-model-note'));
  }

  function sourceLink(url, label = 'Read the source information (DDInter)') {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://ddinter2.scbdd.com' || !(
      /^\/server\/interact\/\d+\/$/.test(parsed.pathname) || parsed.pathname === '/static/media/download/ddinter_downloads_code_A.csv'
    )) throw new Error('Unexpected reference URL.');
    const link = document.createElement('a');
    link.href = parsed.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    return link;
  }

  function details(label, ...children) {
    const element = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = label;
    element.append(summary, ...children);
    return element;
  }

  function heading(text, tag = 'h3') {
    const element = document.createElement(tag);
    element.textContent = text;
    return element;
  }

  function showGuidance(guidance) {
    panel.replaceChildren(heading('About these medicines', 'h2'));
    panel.append(paragraph('Source-based information · For discussion with your doctor or pharmacist', 'ic-model-note'));
    if (guidance.summary) {
      panel.append(heading('What could happen'), paragraph(guidance.summary.what),
        heading('Why this can happen'), paragraph(guidance.summary.why));
    }
    panel.append(paragraph(guidance.summary_note, 'ic-model-note'),
      sourceLink(guidance.source_url), paragraph(`Source saved on ${guidance.accessed_on}.`, 'ic-model-note'));
    panel.append(heading('Questions to discuss'));
    const cards = document.createElement('div');
    cards.className = 'ic-guidance-cards';
    const badges = [];
    guidance.questions.forEach(question => {
      const card = document.createElement('article');
      card.className = 'ic-guidance-card';
      const title = heading(question.title, 'h4');
      if (question.model_selected) {
        const badge = document.createElement('span');
        badge.className = 'ic-model-badge';
        badge.textContent = 'Experimental model highlight';
        badge.hidden = true;
        badges.push(badge);
        title.append(' ', badge);
      }
      card.append(title, paragraph(question.question), details('See the source passage',
        paragraph('Original professional wording; conditions and exceptions may apply.', 'ic-model-note'),
        paragraph(question.source_excerpt), sourceLink(guidance.source_url)));
      cards.append(card);
    });
    if (!guidance.questions.length) cards.append(paragraph('No supported question topics were identified. Ask your pharmacist to help interpret the source.'));
    const modelDetails = details('About the training experiment', paragraph(guidance.model_note));
    const label = document.createElement('label');
    label.className = 'ic-guidance-toggle';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.addEventListener('change', () => {
      badges.forEach(badge => { badge.hidden = !toggle.checked; });
      modelStatus.hidden = !toggle.checked;
    });
    label.append(toggle, ' Show experimental model highlights');
    const modelStatus = paragraph(`${badges.length} source-supported topic(s) highlighted. No highlight does not mean no risk.`, 'ic-model-note');
    modelStatus.hidden = true;
    modelDetails.append(label, modelStatus);
    panel.append(cards, paragraph(guidance.safety_note, 'ic-model-note'),
      details('Read the original source explanation', paragraph(guidance.source_interaction), sourceLink(guidance.source_url)),
      modelDetails);
    panel.hidden = false;
  }

  async function update({ drugA, drugB, level }) {
    clear();
    if (!drugA || !drugB || drugA.toLowerCase() === drugB.toLowerCase()) return;
    if (!level) {
      showMessage('MedSafe does not have information about this medicine pair. That does not mean it is safe to take them together. Ask your doctor or pharmacist.');
      return;
    }
    if (window.location.protocol === 'file:') {
      showMessage('To see suggested questions, start MedSafe with its launcher and open the web address shown in the terminal.');
      return;
    }
    controller = new AbortController();
    const currentController = controller;
    const signal = controller.signal;
    const currentRequest = requestId;
    const timeout = setTimeout(() => currentController.abort(), 12000);
    showMessage('Checking source information for these medicines…');
    try {
      const response = await fetch('/api/guidance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drug_a: drugA, drug_b: drugB }),
        signal,
      });
      if (!response.ok) throw new Error(`Suggestions unavailable (${response.status})`);
      const result = await response.json();
      if (signal.aborted || requestId !== currentRequest) return;
      if (result.severity !== level) throw new Error('The reference result changed.');
      if (result.status !== 'model_selected') {
        showMessage(result.message);
        return;
      }
      if (result.guidance?.status === 'source_available') {
        showGuidance(result.guidance);
        return;
      }
      const heading = document.createElement('h2');
      heading.textContent = 'General questions only';
      const badge = document.createElement('span');
      badge.className = 'ic-model-badge';
      badge.textContent = 'Still being tested';
      heading.append(' ', badge);
      const list = document.createElement('ul');
      result.questions.forEach(question => {
        const item = document.createElement('li');
        item.textContent = question;
        list.append(item);
      });
      const source = sourceLink(result.source_url);
      panel.replaceChildren(
        heading,
        paragraph(result.guidance?.message || 'Detailed source information is unavailable.', 'ic-model-note'),
        paragraph(result.basis_label || 'These questions use the available information about this medicine pair.', 'ic-model-note'),
        list,
        paragraph(result.message, 'ic-model-note'),
        source,
      );
      panel.hidden = false;
    } catch (error) {
      if (requestId !== currentRequest) return;
      showMessage('We could not load the suggested questions. You can still read the result above and ask your doctor or pharmacist about it.');
    } finally {
      clearTimeout(timeout);
    }
  }

  window.MedSafeSuggestions = { clear, update };
})();
