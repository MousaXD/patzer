/* Synchronous pre-paint bootstrap: anonymous visits follow the OS theme. */
(function () {
  var choice = 'auto';
  try {
    var stored = window.localStorage.getItem('patzer-site-theme');
    if (stored === 'dark' || stored === 'light' || stored === 'auto') choice = stored;
  } catch (_) { /* private mode may disable storage */ }
  var dark = choice === 'dark' || (choice === 'auto' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  // Protect even the initial canvas before Vite CSS arrives.
  document.documentElement.style.backgroundColor = dark ? '#171a1c' : '#ffffff';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#171a1c' : '#ffffff');
})();
