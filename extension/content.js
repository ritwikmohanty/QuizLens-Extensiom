(() => {
  const FILTER_STORAGE_KEY = 'gradedOnlyEnabled';
  const SELECTORS = [
    '[data-testid="content-integrity-instructions"]',
    '[data-ai-instructions="true"]',
    '[data-testid="acknowledgment-checkpoint"]',
    '[data-assessment-checkpoint="true"]',
    'button[data-action="acknowledge-guidelines"]'
  ].join(',');
  const HIDDEN_ATTR = 'data-quizlens-graded-hidden';
  const COURSEWORK_ANCHOR_SELECTOR = [
    'a[aria-label][href*="/learn/"][href*="/assignment-submission/"]',
    'a[aria-label][href*="/learn/"][href*="/programming/"]',
    'a[aria-label][href*="/learn/"][href*="/lecture/"]',
    'a[aria-label][href*="/learn/"][href*="/supplement/"]',
    'a[aria-label][href*="/learn/"][href*="/ungradedLab/"]'
  ].join(',');
  const WEEK_ITEM_SELECTOR = 'li[data-testid^="WeekSingleItemDisplay-"], li[data-test^="WeekSingleItemDisplay-"]';
  const WEEK_GRADED_PATTERN = /WeekSingleItemDisplay-(staffGraded|gradedProgramming)/i;

  let gradedOnlyEnabled = true;
  let scheduled = false;

  function stripInjectedElements(root = document) {
    const nodes = root.querySelectorAll ? root.querySelectorAll(SELECTORS) : [];
    nodes.forEach((node) => node.remove());
  }

  function isGradedCoursework(anchor) {
    const row = anchor.closest('li') || anchor;
    const typeText = `${row.getAttribute('data-testid') || ''} ${row.getAttribute('data-test') || ''}`;
    if (WEEK_GRADED_PATTERN.test(typeText)) return true;
    if (/\b(ungraded|practice)\b/i.test(typeText)) return false;

    const label = (anchor.getAttribute('aria-label') || anchor.innerText || '').toLowerCase();
    if (/\bpractice assignment\b/.test(label)) return false;
    return /\bgraded assignment\b/.test(label) || /\bprogramming assignment\b/.test(label);
  }

  function hideNode(node) {
    if (node.hasAttribute(HIDDEN_ATTR)) return;
    node.setAttribute(HIDDEN_ATTR, node.style.display || '');
    node.style.display = 'none';
  }

  function showNode(node) {
    if (!node.hasAttribute(HIDDEN_ATTR)) return;
    const previousDisplay = node.getAttribute(HIDDEN_ATTR);
    node.style.display = previousDisplay;
    node.removeAttribute(HIDDEN_ATTR);
  }

  function restoreFilteredItems(root = document) {
    const nodes = root.querySelectorAll ? root.querySelectorAll(`[${HIDDEN_ATTR}]`) : [];
    nodes.forEach(showNode);
  }

  function filterWeekListItems(root = document) {
    const items = root.querySelectorAll ? root.querySelectorAll(WEEK_ITEM_SELECTOR) : [];
    items.forEach((item) => {
      const typeText = `${item.getAttribute('data-testid') || ''} ${item.getAttribute('data-test') || ''}`;
      const keep = WEEK_GRADED_PATTERN.test(typeText) || /\bgraded assignment\b/i.test(item.innerText || '');
      if (keep) {
        showNode(item);
      } else {
        hideNode(item);
      }
    });
  }

  function filterSidePanelItems(root = document) {
    const anchors = root.querySelectorAll ? root.querySelectorAll(COURSEWORK_ANCHOR_SELECTOR) : [];
    anchors.forEach((anchor) => {
      const row = anchor.closest('li') || anchor;
      if (isGradedCoursework(anchor)) {
        showNode(row);
      } else {
        hideNode(row);
      }
    });
  }

  function applyGradedOnlyFilter(root = document) {
    if (!gradedOnlyEnabled) {
      restoreFilteredItems();
      return;
    }
    filterWeekListItems(root);
    filterSidePanelItems(root);
  }

  function schedulePageCleanup(root = document) {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      stripInjectedElements(root);
      applyGradedOnlyFilter(root);
    });
  }

  chrome.storage.sync.get({ [FILTER_STORAGE_KEY]: true }, (settings) => {
    gradedOnlyEnabled = settings[FILTER_STORAGE_KEY] !== false;
    schedulePageCleanup();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes[FILTER_STORAGE_KEY]) return;
    gradedOnlyEnabled = changes[FILTER_STORAGE_KEY].newValue !== false;
    applyGradedOnlyFilter();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'SET_GRADED_ONLY_FILTER') return undefined;
    gradedOnlyEnabled = message.enabled !== false;
    applyGradedOnlyFilter();
    sendResponse({ ok: true });
    return true;
  });

  stripInjectedElements();
  schedulePageCleanup();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (added.nodeType !== Node.ELEMENT_NODE) continue;
        if (added.matches && added.matches(SELECTORS)) {
          added.remove();
          continue;
        }
        stripInjectedElements(added);
        applyGradedOnlyFilter(added);
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
