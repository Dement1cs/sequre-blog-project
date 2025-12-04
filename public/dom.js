const box = document.getElementById('dom-output');
if (box) {
  box.innerHTML = window.location.hash.substring(1);
}