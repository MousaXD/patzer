/* Synchronous pre-paint theme bootstrap: light is the anonymous/default theme. */
(function () {
  var choice = 'light';
  try {
    var stored = window.localStorage.getItem('patzer-site-theme');
    if (stored === 'dark' || stored === 'light' || stored === 'auto') choice = stored;
  } catch (_) { /* private mode may disable storage */ }
  var dark = choice === 'dark' || (choice === 'auto' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#171a1c' : '#ffffff');
})();
