/* The Little Nest · the only JavaScript on the site.
   Mobile nav toggle and the footer copyright year. Nothing else.
   Cart, checkout and authentication are Zoho Commerce's, not ours. */
(function () {
  var btn = document.querySelector('.nav-toggle');
  var nav = document.getElementById('primary-nav');

  if (btn && nav) {
    /* One writer for the open state, so the button label, aria-expanded and the
       panel attribute can never disagree. They used to be set in three places
       inside the click handler and nowhere else, which is why Escape had
       nothing to call. */
    var setOpen = function (open) {
      nav.setAttribute('data-open', String(open));
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? 'Close' : 'Menu';
    };

    btn.addEventListener('click', function () {
      setOpen(nav.getAttribute('data-open') !== 'true');
    });

    /* ESCAPE CLOSES IT. The panel is a disclosure the toggle owns, and leaving
       it open on Escape stranded a keyboard or screen-reader user inside the
       menu with only the toggle to get out: pressing Escape did nothing at all
       and aria-expanded stayed "true". Measured at 375px on 17 Aug 2026.
       Focus goes back to the button, because that is where it came from and it
       is the only thing that can reopen the panel. */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (nav.getAttribute('data-open') !== 'true') return;
      setOpen(false);
      btn.focus();
    });
  }

  var year = document.querySelector('[data-year]');
  if (year) year.textContent = new Date().getFullYear();
})();
