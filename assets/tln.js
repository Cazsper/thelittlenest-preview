/* The Little Nest — the only JavaScript on the site.
   Mobile nav toggle and the footer copyright year. Nothing else.
   Cart, checkout and authentication are Zoho Commerce's, not ours. */
(function () {
  var btn = document.querySelector('.nav-toggle');
  var nav = document.getElementById('primary-nav');

  if (btn && nav) {
    btn.addEventListener('click', function () {
      var open = nav.getAttribute('data-open') === 'true';
      nav.setAttribute('data-open', String(!open));
      btn.setAttribute('aria-expanded', String(!open));
      btn.textContent = open ? 'Menu' : 'Close';
    });
  }

  var year = document.querySelector('[data-year]');
  if (year) year.textContent = new Date().getFullYear();
})();
