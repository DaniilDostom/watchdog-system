// Small DOM utilities used for concise, readable code
(function(global){
  function q(sel, ctx){ return (ctx || document).querySelector(sel); }
  function qAll(sel, ctx){ return Array.from((ctx || document).querySelectorAll(sel)); }
  function id(name){ return document.getElementById(name); }
  function on(el, ev, fn, opts){ (el||document).addEventListener(ev, fn, opts); }
  function ready(fn){ if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  function addClass(el, cls){ if(el && !el.classList.contains(cls)) el.classList.add(cls); }
  function removeClass(el, cls){ if(el && el.classList.contains(cls)) el.classList.remove(cls); }
  function setStyles(el, styles){ if(!el) return; Object.keys(styles).forEach(k=>el.style[k]=styles[k]); }
  function hasClass(el, cls){ return el && el.classList.contains(cls); }
  global.DomUtils = { q, qAll, id, on, ready, addClass, removeClass, setStyles, hasClass };
})(window);
