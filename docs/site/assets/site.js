// Agent Swarm docs site — progressive enhancement only.
// The site renders fully without JavaScript; this script adds a mobile
// navigation toggle, marks the active nav link, and adds copy buttons to
// code blocks. Loaded with `defer`, so the DOM is ready when it runs.

(function () {
  "use strict";

  // Mobile navigation toggle.
  var toggle = document.querySelector(".site-nav__toggle");
  var nav = document.querySelector(".site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.getAttribute("data-open") === "true";
      nav.setAttribute("data-open", open ? "false" : "true");
      toggle.setAttribute("aria-expanded", open ? "false" : "true");
    });
  }

  // Highlight the current page in the navigation as a fallback for pages that
  // do not hard-code aria-current.
  var here = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".site-nav a").forEach(function (link) {
    var target = (link.getAttribute("href") || "").split("/").pop();
    if (target === here && !link.hasAttribute("aria-current")) {
      link.setAttribute("aria-current", "page");
    }
  });

  // Add copy-to-clipboard buttons to fenced code blocks.
  if (navigator.clipboard) {
    document.querySelectorAll("pre > code").forEach(function (code) {
      var pre = code.parentElement;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "copy-btn";
      button.textContent = "Copy";
      button.addEventListener("click", function () {
        navigator.clipboard.writeText(code.innerText).then(function () {
          button.textContent = "Copied";
          setTimeout(function () {
            button.textContent = "Copy";
          }, 1500);
        });
      });
      pre.appendChild(button);
    });
  }
})();
