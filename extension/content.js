(() => {
  const SELECTORS = [
    '[data-testid="content-integrity-instructions"]',
    '[data-ai-instructions="true"]',
    '[data-testid="acknowledgment-checkpoint"]',
    '[data-assessment-checkpoint="true"]',
    'button[data-action="acknowledge-guidelines"]'
  ].join(',');

  function stripInjectedElements(root = document) {
    const nodes = root.querySelectorAll ? root.querySelectorAll(SELECTORS) : [];
    nodes.forEach((node) => node.remove());
  }
  stripInjectedElements();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (added.nodeType !== Node.ELEMENT_NODE) continue;
        if (added.matches && added.matches(SELECTORS)) {
          added.remove();
          continue;
        }
        stripInjectedElements(added);
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
