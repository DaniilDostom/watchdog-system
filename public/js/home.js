DomUtils.ready(() => {
  const root = DomUtils.q('.home-root');
  const overlay = DomUtils.id('intro-overlay');
  const introLogo = DomUtils.id('introLogo');
  const headerLogo = DomUtils.q('.home-header .logo');

  // Respect reduced motion
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) {
    // skip animations, just show tools and hide overlay
    DomUtils.addClass(overlay, 'intro-hidden');
    DomUtils.addClass(root, 'show-tools');
    return;
  }

  // Stage 1: pop animation
  // ensure overlay is visible immediately
  if (overlay) {
    DomUtils.removeClass(overlay, 'intro-hidden');
    DomUtils.setStyles(overlay, { visibility: 'visible', opacity: '1' });
  }
  if (introLogo) { DomUtils.setStyles(introLogo, { opacity: '1' }); }
  DomUtils.addClass(root, 'intro-animate');

  // After pop, compute transform to move logo into header
     // original pop duration plus extra 1000ms to keep logo visible longer
     const POP_DURATION = 1780;
     const SHRINK_DELAY = 420;
  setTimeout(() => {
    if (!introLogo) return finish();

    // compute bounding boxes
    const from = introLogo.getBoundingClientRect();
    // fallback if headerLogo not present (robust across loads)
    let to = headerLogo ? headerLogo.getBoundingClientRect() : null;
    if (!to) {
      const targetWidth = Math.min(140, Math.max(64, from.width * 0.44));
      to = { left: window.innerWidth / 2 - targetWidth / 2, top: 18, width: targetWidth, height: 28 };
    }

    // centers
    const fromCx = from.left + from.width / 2;
    const fromCy = from.top + from.height / 2;
    const toCx = to.left + to.width / 2;
    const toCy = to.top + to.height / 2;

    const dx = toCx - fromCx;
    const dy = toCy - fromCy;

    // scale target (header logo is text, approximate smaller scale)
    const scale = (to.width / from.width) || 0.45;

    // apply shrink class to trigger CSS keyframe slightly before translating
    DomUtils.addClass(root, 'intro-shrink');

    // then apply transform to move into header position
    introLogo.style.transition = `transform 720ms cubic-bezier(.2,.9,.2,1) ${SHRINK_DELAY}ms, opacity 420ms ease ${SHRINK_DELAY}ms`;
    introLogo.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    introLogo.style.transformOrigin = 'center center';

    // after animation finishes, hide overlay and reveal tools
    const total = POP_DURATION + SHRINK_DELAY + 760; // buffer
    setTimeout(finish, total);
  }, POP_DURATION);

  function finish() {
    if (overlay) {
      DomUtils.addClass(overlay, 'intro-hidden');
      DomUtils.setStyles(overlay, { visibility: 'hidden', opacity: '0' });
    }
    // show tools with stagger
    DomUtils.addClass(root, 'show-tools');
    // cleanup inline styles
    if (introLogo) {
      introLogo.style.transition = '';
      introLogo.style.transform = '';
    }
  }
});
