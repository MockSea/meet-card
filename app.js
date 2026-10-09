(() => {
  "use strict";

  const SIDES = ["mo", "moxy"];
  const AUTO_ADVANCE_MS = 6500;
  const SWIPE_THRESHOLD_PX = 44;
  const PHOTO_DIR = "photos/mo/";
  const PHOTO_SMALL_DIR = "photos/mo/sm/";
  const HTTP_URL = /^https?:\/\//;

  const byId = (id) => document.getElementById(id);
  const split = byId("split");
  const halves = { mo: byId("mo"), moxy: byId("moxy") };
  const scrollers = { mo: byId("scroll-mo"), moxy: byId("scroll-moxy") };
  // the card is fully hidden this long after a close (see .card in styles.css)
  const CARD_HIDDEN_MS = 200;
  const REOPEN_GUARD_MS = 450;
  const teasers = { mo: byId("teaser-mo"), moxy: byId("teaser-moxy") };
  const headings = { mo: byId("mo-heading"), moxy: byId("moxy-heading") };
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------------------------------------------------------------
     Split state follows the hash: "", "#mo", "#moxy"
     --------------------------------------------------------------- */

  const sideFromHash = () => {
    const h = location.hash.replace(/^#/, "");
    return SIDES.includes(h) ? h : null;
  };

  const setInert = (el, on) => {
    if (on) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  };

  let current = null;
  let lastTap = false;
  document.addEventListener("pointerdown", () => { lastTap = true; }, true);
  document.addEventListener("keydown", () => { lastTap = false; }, true);

  // The closed half and the open half's own teaser drop out of the tab
  // order; focus lands on the opened card's heading, and goes back to the
  // teaser it came from on the way out.
  const applySide = ({ focus = true } = {}) => {
    const side = sideFromHash();
    const prev = current;
    if (side === prev && (side ? split.dataset.side === side : !split.dataset.side)) return;
    current = side;

    if (side) {
      split.dataset.side = side;
      scrollers[side].scrollTop = 0;
      document.title = side === "mo" ? "meet Mo" : "meet Moxy";
    } else {
      delete split.dataset.side;
      document.title = "meet Mo · meet Moxy";
      // once the card has faded, drop its scroll position so the next open
      // starts at the top (the teaser itself never scrolls)
      setTimeout(() => {
        if (split.dataset.side) return;
        for (const s of SIDES) scrollers[s].scrollTop = 0;
      }, CARD_HIDDEN_MS);
    }
    for (const s of SIDES) {
      setInert(halves[s], Boolean(side) && side !== s);
      setInert(teasers[s], side === s);
    }

    if (!focus) return;
    // A tap home leaves focus alone: WebKit draws the ring on a scripted
    // focus whatever the input, so only keyboard users get the teaser back.
    const target = side ? headings[side] : prev && !lastTap ? teasers[prev] : null;
    if (!target) return;
    // A fragment navigation hands focus to the viewport on the next frame,
    // after this handler has run; wait that out before claiming it.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (sideFromHash() !== side) return;
      target.focus({ preventScroll: true });
    }));
  };

  const goTo = (hash) => {
    if (location.hash !== hash) history.pushState(null, "", location.pathname + location.search + hash);
    applySide();
  };
  // A second quick tap on "both" lands on the teaser underneath once the
  // card has gone; swallow opens for the length of the close transition.
  let homedAt = -Infinity;
  const goHome = () => {
    homedAt = performance.now();
    goTo("");
  };

  window.addEventListener("hashchange", () => applySide());
  window.addEventListener("popstate", () => applySide());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sideFromHash()) goHome();
  });
  // In-page links switch sides without a fragment navigation, so nothing
  // scrolls or steals focus; the hash still lands in the URL for sharing.
  for (const el of split.querySelectorAll('a[href^="#"]')) {
    el.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      const h = el.getAttribute("href");
      if (!SIDES.includes(h.slice(1))) return goHome();
      if (performance.now() - homedAt < REOPEN_GUARD_MS) return;
      goTo(h);
    });
  }

  // Deep links land already open: nothing animates, including the card.
  if (sideFromHash()) {
    split.classList.add("no-anim");
    applySide({ focus: false });
    requestAnimationFrame(() => requestAnimationFrame(() => split.classList.remove("no-anim")));
  } else {
    applySide({ focus: false });
  }

  /* ---------------------------------------------------------------
     Mo: photo carousel from photos/mo/manifest.json
     --------------------------------------------------------------- */

  const shuffle = (list) => {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  const pad = (n) => String(n).padStart(2, "0");

  const buildCarousel = (photos) => {
    const root = byId("carousel");
    const track = byId("carousel-track");
    const count = byId("carousel-count");
    const pauseBtn = byId("carousel-pause");
    const section = root.closest(".mo-carousel");
    const n = photos.length;

    const slides = photos.map((p, i) => {
      const slide = document.createElement("div");
      slide.className = "carousel__slide";
      slide.setAttribute("role", "group");
      slide.setAttribute("aria-roledescription", "slide");
      slide.setAttribute("aria-label", `${i + 1} of ${n}`);
      const img = document.createElement("img");
      img.alt = typeof p.alt === "string" ? p.alt : "";
      img.loading = "lazy";
      img.decoding = "async";
      img.draggable = false;
      img.dataset.src = p.src;
      img.addEventListener("error", () => {
        if (img.dataset.fallback) return;
        img.dataset.fallback = "1";
        img.src = PHOTO_DIR + p.src;
      });
      slide.appendChild(img);
      track.appendChild(slide);
      return { slide, img };
    });

    let index = 0;
    let timer = null;
    const hold = { user: false, hover: false, focus: false, touch: false };

    const load = (i) => {
      const { img } = slides[(i + n) % n];
      if (!img.getAttribute("src")) img.src = PHOTO_SMALL_DIR + img.dataset.src;
    };

    const render = () => {
      track.style.transform = `translateX(${-index * 100}%)`;
      count.textContent = `${pad(index + 1)} / ${pad(n)}`;
      slides.forEach(({ slide }, i) => slide.setAttribute("aria-hidden", i === index ? "false" : "true"));
      load(index); load(index + 1); load(index - 1);
    };

    const tick = () => {
      if (document.hidden || split.dataset.side !== "mo") return;
      index = (index + 1) % n;
      render();
    };

    const running = () => !hold.user && !hold.hover && !hold.focus && !hold.touch && !reduceMotion.matches;

    // Any change to what's holding the slideshow restarts the clock, so the
    // next advance is always a full interval away.
    const schedule = () => {
      if (timer) clearInterval(timer);
      timer = running() ? setInterval(tick, AUTO_ADVANCE_MS) : null;
      // the button says what the slideshow is actually doing: under reduced
      // motion it never runs, so it reads "play" even before a tap
      const stopped = hold.user || reduceMotion.matches;
      pauseBtn.setAttribute("aria-pressed", String(stopped));
      pauseBtn.setAttribute("aria-label", stopped ? "Play slideshow" : "Pause slideshow");
      pauseBtn.textContent = stopped ? "play" : "pause";
    };

    const go = (dir) => {
      index = (index + dir + n) % n;
      render();
      schedule();
    };

    for (const btn of section.querySelectorAll("[data-dir]")) {
      btn.addEventListener("click", () => go(Number(btn.dataset.dir)));
    }

    pauseBtn.addEventListener("click", () => {
      hold.user = !hold.user;
      schedule();
    });

    root.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    });

    // hover and keyboard focus hold the slideshow; so does a finger on it
    root.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "mouse") return;
      hold.hover = true; schedule();
    });
    root.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse") return;
      hold.hover = false; schedule();
    });
    section.addEventListener("focusin", () => { hold.focus = true; schedule(); });
    section.addEventListener("focusout", (e) => {
      if (section.contains(e.relatedTarget)) return;
      hold.focus = false; schedule();
    });

    // swipe
    let startX = 0;
    let dragging = false;
    root.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      startX = e.clientX;
      dragging = true;
      root.classList.add("is-dragging");
      if (e.pointerType !== "mouse") { hold.touch = true; schedule(); }
      try { root.setPointerCapture(e.pointerId); } catch (_) { /* pointer already released */ }
    });
    root.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      track.style.transform = `translateX(calc(${-index * 100}% + ${dx}px))`;
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      root.classList.remove("is-dragging");
      hold.touch = false;
      const dx = e.clientX - startX;
      if (dx <= -SWIPE_THRESHOLD_PX) go(1);
      else if (dx >= SWIPE_THRESHOLD_PX) go(-1);
      else { render(); schedule(); }
    };
    root.addEventListener("pointerup", endDrag);
    root.addEventListener("pointercancel", endDrag);

    render();
    schedule();
    reduceMotion.addEventListener("change", schedule);
  };

  fetch("photos/mo/manifest.json")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`manifest ${r.status}`))))
    .then((list) => {
      const photos = Array.isArray(list) ? list.filter((p) => p && typeof p.src === "string") : [];
      if (photos.length === 0) throw new Error("manifest has no photos");
      // Item 0 is the deliberate opener; the rest rotate in random order.
      buildCarousel([photos[0], ...shuffle(photos.slice(1))]);
    })
    .catch((err) => {
      console.error("carousel:", err);
      document.querySelector(".mo-carousel").hidden = true;
    });

  /* ---------------------------------------------------------------
     Mo: projects and profiles from mo/links.json. An entry without an
     http(s) href is not rendered at all.
     --------------------------------------------------------------- */

  const hasHref = (item) => item && typeof item.href === "string" && HTTP_URL.test(item.href);

  const chip = (item, extraClass) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.className = extraClass ? `chip ${extraClass}` : "chip";
    a.href = item.href;
    a.textContent = item.label || item.href.replace(HTTP_URL, "");
    if (item.me) a.rel = "me";
    if (item.note) {
      const note = document.createElement("small");
      note.textContent = item.note;
      a.appendChild(note);
    }
    li.appendChild(a);
    return li;
  };

  const fillChips = (id, list, extraClass) => {
    const ul = byId(id);
    const items = (Array.isArray(list) ? list : []).filter(hasHref);
    if (items.length === 0) { ul.closest(".links-group").hidden = true; return; }
    ul.replaceChildren(...items.map((item) => chip(item, extraClass)));
  };

  fetch("mo/links.json")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`links ${r.status}`))))
    .then((data) => {
      const d = data && typeof data === "object" ? data : {};
      fillChips("mo-projects", d.projects, "chip--project");
      fillChips("mo-social", d.social, "");
    })
    .catch((err) => {
      console.error("links:", err);
      document.querySelector(".mo-links").hidden = true;
    });

  /* ---------------------------------------------------------------
     Moxy: cover stories from moxy/builds.json. One build is a feature;
     two or more become a rail.
     --------------------------------------------------------------- */

  const isBuild = (b) => b && typeof b.url === "string" && HTTP_URL.test(b.url);

  const storyEl = (b, i, kind) => {
    const el = document.createElement("a");
    el.className = kind;
    el.href = b.url;
    el.rel = "noopener";

    const num = document.createElement("span");
    num.className = `${kind}__num`;
    num.textContent = b.num || pad(i + 1);

    const title = document.createElement("h3");
    title.className = `${kind}__title`;
    title.textContent = b.title || b.url.replace(HTTP_URL, "");

    const dek = document.createElement("p");
    dek.className = `${kind}__dek`;
    dek.textContent = b.dek || "";

    const cta = document.createElement("span");
    cta.className = `kicker ${kind}__cta`;
    cta.textContent = "Read";

    if (kind === "feature") {
      // a lone story is not numbered
      el.append(title, dek, cta);
    } else {
      const body = document.createElement("div");
      body.append(title, dek);
      el.append(num, body, cta);
    }
    return el;
  };

  fetch("moxy/builds.json")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`builds ${r.status}`))))
    .then((list) => {
      const box = byId("stories");
      const builds = (Array.isArray(list) ? list : []).filter(isBuild);
      if (builds.length === 0) throw new Error("no builds");
      if (builds.length === 1) {
        box.className = "stories__one";
        box.replaceChildren(storyEl(builds[0], 0, "feature"));
      } else {
        box.className = "stories__rail";
        box.replaceChildren(...builds.map((b, i) => storyEl(b, i, "story")));
      }
    })
    .catch((err) => {
      console.error("stories:", err);
      document.querySelector(".stories").hidden = true;
    });
})();
