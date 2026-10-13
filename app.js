(() => {
  "use strict";

  const SIDES = ["mo", "moxy"];
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
     Mo: the photo wall, from photos/mo/manifest.json. The landing gets a
     dimmed mosaic of the first few; the card gets rows of tiles drifting
     sideways, alternate rows the other way, looping without a seam.
     Anything in the manifest shows up; nothing here knows the photos.
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

  // sm/ first, the full-size original if that is missing
  const photoImg = (p, { eager = false } = {}) => {
    const img = document.createElement("img");
    img.alt = typeof p.alt === "string" ? p.alt : "";
    img.decoding = "async";
    img.draggable = false;
    if (Number.isFinite(p.w) && Number.isFinite(p.h)) { img.width = p.w; img.height = p.h; }
    img.dataset.src = p.src;
    img.addEventListener("error", () => {
      if (img.dataset.fallback) return;
      img.dataset.fallback = "1";
      img.src = PHOTO_DIR + p.src;
    });
    if (eager) img.src = PHOTO_SMALL_DIR + p.src;
    return img;
  };

  const buildWall = (photos) => {
    const wall = byId("wall");
    if (!wall) return;
    wall.replaceChildren(...photos.slice(0, WALL_TILES).map((p) => photoImg(p, { eager: true })));
  };

  // A drift speed, not a duration: every row crosses one set of photos at
  // the same pixels per second however wide its set happens to be.
  const DRIFT_PX_PER_S = 28;
  const WALL_TILES = 9;

  const buildMarquee = (photos) => {
    const root = byId("marquee");
    if (!root) return;
    const rowCount = () => Math.max(1, parseInt(getComputedStyle(root).getPropertyValue("--rows"), 10) || 1);
    let rows = [];

    const layout = () => {
      const w = root.clientWidth;
      if (!w) return;
      for (const { row, track, set, copies: existing } of rows) {
        const setW = set.getBoundingClientRect().width;
        if (!setW) continue;
        // enough copies that the row is covered while one set's width
        // scrolls by, and no photo is on screen twice if we can help it
        const copies = Math.max(2, Math.ceil(w / setW) + 1);
        if (copies !== existing.length + 1) {
          for (const c of existing) c.remove();
          existing.length = 0;
          for (let i = 1; i < copies; i++) {
            const clone = set.cloneNode(true);
            clone.classList.add("marquee__set--clone");
            clone.setAttribute("aria-hidden", "true");
            for (const img of clone.querySelectorAll("img")) {
              const src = set.querySelector(`img[data-src="${img.dataset.src}"]`);
              if (src && src.getAttribute("src")) img.src = src.getAttribute("src");
            }
            track.appendChild(clone);
            existing.push(clone);
          }
        }
        track.style.setProperty("--copies", String(copies));
        track.style.setProperty("--dur", `${Math.round(setW / DRIFT_PX_PER_S)}s`);
        row.dataset.copies = String(copies);
      }
    };

    const build = () => {
      const n = rowCount();
      rows = Array.from({ length: n }, () => {
        const row = document.createElement("div");
        row.className = "marquee__row";
        const track = document.createElement("div");
        track.className = "marquee__track";
        const set = document.createElement("div");
        set.className = "marquee__set";
        track.appendChild(set);
        row.appendChild(track);
        return { row, track, set, copies: [] };
      });
      photos.forEach((p, i) => {
        const fig = document.createElement("figure");
        fig.className = "marquee__tile";
        const img = photoImg(p);
        // the tile's shape comes from the manifest, so rows are the right
        // width before a byte of the photo arrives; otherwise from the file
        if (img.width && img.height) fig.style.aspectRatio = `${img.width} / ${img.height}`;
        else img.addEventListener("load", () => { fig.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`; }, { once: true });
        fig.appendChild(img);
        rows[i % n].set.appendChild(fig);
      });
      root.replaceChildren(...rows.map((r) => r.row));
      layout();
    };

    // a finger on the wall holds it; hover is handled in CSS
    root.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;
      root.classList.add("is-held");
    });
    const release = () => root.classList.remove("is-held");
    root.addEventListener("pointerup", release);
    root.addEventListener("pointercancel", release);
    root.addEventListener("pointerleave", release);

    // the row count is a CSS variable, so a breakpoint change rebuilds
    let lastRows = rowCount();
    const onResize = () => {
      const n = rowCount();
      if (n !== lastRows) { lastRows = n; build(); primeGallery(); }
      else layout();
    };
    // a frame later, so re-laying out the rows never counts as a resize
    // the observer has to report on in the same pass
    const onResizeLater = () => requestAnimationFrame(onResize);
    if ("ResizeObserver" in window) new ResizeObserver(onResizeLater).observe(root);
    else window.addEventListener("resize", onResizeLater);

    build();
    // once the images know their size the sets may be wider: lay out again
    root.addEventListener("load", layout, true);
  };

  // The card's photos stay unrequested until Mo's side opens, so the
  // landing is light. Clones copy whatever the original has loaded.
  let primed = false;
  const primeGallery = () => {
    const root = byId("marquee");
    if (!root || split.dataset.side !== "mo") return;
    primed = true;
    for (const img of root.querySelectorAll("img")) {
      if (!img.getAttribute("src")) img.src = PHOTO_SMALL_DIR + img.dataset.src;
    }
  };
  split.addEventListener("transitionend", () => { if (!primed) primeGallery(); });
  const primeOnOpen = new MutationObserver(() => { if (!primed) primeGallery(); });
  primeOnOpen.observe(split, { attributes: true, attributeFilter: ["data-side"] });

  fetch("photos/mo/manifest.json")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`manifest ${r.status}`))))
    .then((list) => {
      const photos = Array.isArray(list) ? list.filter((p) => p && typeof p.src === "string") : [];
      if (photos.length === 0) throw new Error("manifest has no photos");
      // Item 0 is the deliberate opener; the rest land in random order.
      const ordered = [photos[0], ...shuffle(photos.slice(1))];
      buildWall(ordered);
      buildMarquee(ordered);
      primeGallery();
    })
    .catch((err) => {
      console.error("gallery:", err);
      const g = document.querySelector(".gallery");
      if (g) g.hidden = true;
    });

  /* ---------------------------------------------------------------
     Mo: projects and profiles from mo/links.json. An entry without an
     http(s) href is not rendered at all.
     --------------------------------------------------------------- */

  const hasHref = (item) => item && typeof item.href === "string" && HTTP_URL.test(item.href);

  const tile = (item) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.className = "tile";
    a.href = item.href;
    if (item.me) a.rel = "me";
    const val = document.createElement("span");
    val.className = "tile__val";
    val.textContent = item.label || item.href.replace(HTTP_URL, "");
    if (item.note) {
      const label = document.createElement("span");
      label.className = "tile__label";
      label.textContent = item.note;
      a.append(label, val);
    } else {
      a.append(val);
    }
    li.appendChild(a);
    return li;
  };

  const fillTiles = (id, list) => {
    const ul = byId(id);
    const items = (Array.isArray(list) ? list : []).filter(hasHref);
    if (items.length === 0) { ul.closest(".links-group").hidden = true; return; }
    ul.replaceChildren(...items.map(tile));
  };

  fetch("mo/links.json")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`links ${r.status}`))))
    .then((data) => {
      const d = data && typeof data === "object" ? data : {};
      fillTiles("mo-projects", d.projects);
      fillTiles("mo-social", d.social);
    })
    .catch((err) => {
      console.error("links:", err);
      document.querySelector(".mo-links").hidden = true;
    });

  /* ---------------------------------------------------------------
     Moxy: cover stories from moxy/builds.json. One build is a feature;
     two or more become a rail of news items, snapped one per swipe, with
     a position readout and prev/next under it.
     --------------------------------------------------------------- */

  const isBuild = (b) => b && typeof b.url === "string" && (HTTP_URL.test(b.url) || /^moxy\/stories\/[a-z0-9-]+\.html$/.test(b.url));
  const text = (v) => (typeof v === "string" ? v.trim() : "");

  // "SECURITY · OCT 2": section in red, date after a middle dot
  const datelineEl = (b, kind) => {
    const section = text(b.section);
    const date = text(b.date);
    if (!section && !date) return null;
    const line = document.createElement("p");
    line.className = `kicker ${kind}__dateline`;
    if (section) {
      const s = document.createElement("span");
      s.className = `${kind}__section`;
      s.textContent = section;
      line.appendChild(s);
    }
    if (section && date) {
      const dot = document.createElement("span");
      dot.className = `${kind}__dot`;
      dot.setAttribute("aria-hidden", "true");
      dot.textContent = " · ";
      line.appendChild(dot);
    }
    if (date) {
      const d = document.createElement("span");
      d.className = `${kind}__date`;
      d.textContent = date;
      line.appendChild(d);
    }
    return line;
  };

  const storyEl = (b, i, kind) => {
    const el = document.createElement("a");
    el.className = kind;
    el.href = b.url;
    el.rel = "noopener";

    const head = document.createElement("div");
    head.className = `${kind}__head`;
    const dateline = datelineEl(b, kind);
    if (dateline) head.appendChild(dateline);

    const title = document.createElement("h3");
    title.className = `${kind}__title`;
    title.textContent = text(b.title) || b.url.replace(HTTP_URL, "");

    const dek = document.createElement("p");
    dek.className = `${kind}__dek`;
    dek.textContent = text(b.dek);

    const cta = document.createElement("span");
    cta.className = `kicker ${kind}__cta`;
    cta.textContent = "Read";

    if (kind === "feature") {
      // a lone story is not numbered, and gets no head without a dateline
      if (dateline) el.append(head);
      el.append(title, dek, cta);
    } else {
      const num = document.createElement("span");
      num.className = `${kind}__num folio`;
      num.setAttribute("aria-hidden", "true");
      num.textContent = text(b.num) || pad(i + 1);
      head.appendChild(num);
      if (i === 0) el.classList.add(`${kind}--lead`);
      el.append(head, title, dek, cta);
    }
    return el;
  };

  // The rail scrolls itself; this keeps the readout and the buttons in
  // step with it, and lets the buttons and arrow keys drive it.
  const wireRail = (rail, cards) => {
    const bar = byId("stories-bar");
    const pos = byId("stories-pos");
    const prev = byId("stories-prev");
    const next = byId("stories-next");
    if (!bar || !pos || !prev || !next) return;
    const last = cards.length - 1;

    rail.setAttribute("role", "group");
    rail.setAttribute("aria-roledescription", "carousel");
    rail.setAttribute("aria-label", "Cover stories");

    // snap positions sit at each card's left edge, less the rail's padding
    const padLeft = () => parseFloat(getComputedStyle(rail).paddingLeft) || 0;
    const targetFor = (i) => cards[i].offsetLeft - padLeft();
    const indexAt = (x) => {
      let best = 0;
      let dist = Infinity;
      cards.forEach((_, i) => {
        const d = Math.abs(targetFor(i) - x);
        if (d < dist) { dist = d; best = i; }
      });
      return best;
    };

    let index = -1;
    const show = (i) => {
      if (i === index) return;
      index = i;
      pos.textContent = `${pad(i + 1)} / ${pad(cards.length)}`;
      prev.disabled = i <= 0;
      next.disabled = i >= last;
      // a button that just disabled itself would drop focus on the body
      if (prev.disabled && document.activeElement === prev) next.focus();
      if (next.disabled && document.activeElement === next) prev.focus();
    };

    const go = (i, { focus = false } = {}) => {
      const to = Math.max(0, Math.min(last, i));
      rail.scrollTo({ left: targetFor(to), behavior: reduceMotion.matches ? "auto" : "smooth" });
      show(to);
      if (focus) cards[to].focus({ preventScroll: true });
    };

    prev.addEventListener("click", () => go(index - 1));
    next.addEventListener("click", () => go(index + 1));
    rail.addEventListener("keydown", (e) => {
      const at = cards.indexOf(document.activeElement);
      if (at < 0) return;
      const keys = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: last };
      if (!(e.key in keys)) return;
      e.preventDefault();
      go(keys[e.key], { focus: true });
    });

    let frame = 0;
    const sync = () => {
      frame = 0;
      show(indexAt(rail.scrollLeft));
    };
    rail.addEventListener("scroll", () => { if (!frame) frame = requestAnimationFrame(sync); }, { passive: true });
    if ("ResizeObserver" in window) new ResizeObserver(() => { if (!frame) frame = requestAnimationFrame(sync); }).observe(rail);

    bar.hidden = false;
    sync();
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
        const cards = builds.map((b, i) => storyEl(b, i, "story"));
        box.replaceChildren(...cards);
        wireRail(box, cards);
      }
    })
    .catch((err) => {
      console.error("stories:", err);
      document.querySelector(".stories").hidden = true;
    });
})();
