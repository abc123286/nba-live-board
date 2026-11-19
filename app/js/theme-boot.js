// Apply saved theme before first paint (no flash). Classic script so it runs synchronously.
try {
  var t = JSON.parse(localStorage.getItem("nbalive:theme"));
  if (!t) t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = t;
} catch (e) {}
