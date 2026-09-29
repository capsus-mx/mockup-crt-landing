/* Portal Huella Tequila — hidrata panorama + gráfica desde el contrato (#datos). */
(function () {
  "use strict";
  var DATOS = JSON.parse(document.getElementById("datos").textContent);
  var ciclo = DATOS.ciclo || {};
  var faseColor = {};
  (DATOS.catalogoFases || []).forEach(function (f) { faseColor[f.id] = { color: f.color, mayus: f.mayus }; });

  var metric = "carbono";
  var chart = null;

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Revelado fade-up de bloques + zoom sutil de bandas al entrar en viewport.
  var reveals = document.querySelectorAll("[data-reveal]");
  if (reveals.length) {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      reveals.forEach(function (el) { el.classList.add("is-in"); });
    } else {
      var ro = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add("is-in"); ro.unobserve(e.target); }
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
      reveals.forEach(function (el) { ro.observe(el); });
    }
  }

  // Panorama scroll-driven: bajo el SVG + total, se APILAN por etapas el desglose y la neta.
  (function initPanoramaRail() {
    var rail = document.querySelector('[data-rail="b1"]');
    if (!rail) return;
    var rows = rail.querySelectorAll("[data-b1-row]");
    var dots = rail.querySelectorAll(".b1-dots span");
    var narrow = window.matchMedia && window.matchMedia("(max-width: 1023px)").matches;
    if (reduceMotion || narrow) {  // móvil / sin animación: todo visible, sin rail
      rows.forEach(function (r) { r.classList.add("is-in"); });
      return;
    }
    var revealAt = [0.26, 0.54];   // fila 1 (desglose) · fila 2 (huella neta)
    function progress() {
      var r = rail.getBoundingClientRect();
      var span = r.height - window.innerHeight;
      return Math.max(0, Math.min(1, -r.top / (span || 1)));
    }
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var p = progress();
        var step = 0;
        if (p >= revealAt[0]) step = 1;
        if (p >= revealAt[1]) step = 2;
        rows.forEach(function (row, i) { row.classList.toggle("is-in", i < step); });
        dots.forEach(function (d, i) { d.classList.toggle("on", i <= step); });
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
  })();

  function fmt(v) {
    // Hasta 2 decimales, recortando ceros sobrantes; coma decimal.
    var s = Number(v).toFixed(2).replace(/\.?0+$/, "");
    return s.replace(".", ",");
  }
  function q(sel) { return document.querySelectorAll(sel); }
  function setText(sel, txt) { q(sel).forEach(function (n) { n.textContent = txt; }); }

  // Ocultar sellos "dato de ejemplo" si el ciclo ya no es ilustrativo.
  if (ciclo.esIlustrativo === false) {
    q("[data-sello]").forEach(function (n) { n.style.display = "none"; });
  }

  function renderPanorama() {
    var m = (ciclo.metricas || {})[metric];
    if (!m) return;
    var dec = m.decimales != null ? m.decimales : (metric === "agua" ? 0 : 2);
    var neto = m.bruto - m.reduccion;
    var reduPct = Math.round((m.reduccion / m.bruto) * 100);
    var esAgua = metric === "agua";

    setText("[data-bruto-num]", fmt(m.bruto, dec));
    setText("[data-bruto-unit]", m.unidadCorta || "");
    setText("[data-bruto-label]", esAgua
      ? "Huella hídrica bruta (agua azul) por litro de tequila"
      : "Huella bruta de carbono por litro de tequila");
    setText("[data-reparto-caption]", esAgua
      ? "La misma agua, repartida entre las cuatro fases"
      : "La misma huella, repartida entre las cuatro fases");

    // barra segmentada + leyenda
    var split = document.querySelector("[data-split]");
    var legend = document.querySelector("[data-legend]");
    split.innerHTML = ""; legend.innerHTML = "";
    (m.porFase || []).forEach(function (pf) {
      var fc = faseColor[pf.fase] || { color: "#ccc", mayus: pf.fase };
      var seg = document.createElement("div");
      seg.className = "seg";
      seg.style.width = pf.pct + "%";
      seg.style.background = fc.color;
      seg.textContent = fmt(pf.valor, dec);
      split.appendChild(seg);

      var item = document.createElement("span");
      item.className = "item";
      item.innerHTML = '<span class="dot" style="background:' + fc.color + '"></span>' +
        fc.mayus + ' <span class="muted small">' + fmt(pf.valor, dec) + " · " + pf.pct + " %</span>";
      legend.appendChild(item);
    });

    setText("[data-neta-num]", fmt(neto, dec));
    setText("[data-neta-unit]", m.unidadCorta || "");
    setText("[data-redu-num]", "− " + fmt(m.reduccion, dec));
    setText("[data-redu-pct]", "−" + reduPct + " %");
    setText("[data-neta-titulo]", esAgua ? "Huella hídrica neta" : "Huella neta");
    setText("[data-neta-resto]", "= Huella bruta − " + (m.reduccionConcepto || "") +
      (ciclo.esIlustrativo === false ? "" : " · dato de ejemplo"));
  }

  function renderChart() {
    var serie = (DATOS.trayectoria || {}).series ? DATOS.trayectoria.series[metric] : null;
    var canvas = document.getElementById("trayectoria-chart");
    if (!serie || !canvas || !window.Chart) return;
    var dec = metric === "agua" ? 0 : 2;

    setText("[data-ch-titulo]", metric === "agua"
      ? "Huella hídrica por cada litro de tequila"
      : "Huella de carbono por cada litro de tequila");
    setText("[data-ch-nota]", serie.nota || "");

    var legend = document.querySelector("[data-ch-legend]");
    legend.innerHTML = "";
    serie.datasets.forEach(function (ds) {
      var it = document.createElement("span");
      it.className = "item";
      it.innerHTML = '<span class="dot" style="background:' + ds.color + '"></span>' + ds.label;
      legend.appendChild(it);
    });

    var cfgDatasets = serie.datasets.map(function (ds) {
      return {
        label: ds.label, borderColor: ds.color, backgroundColor: ds.color,
        pointBackgroundColor: ds.color, pointBorderColor: "#fff", pointBorderWidth: 2,
        pointRadius: 6, borderWidth: 3, tension: 0,
        data: ds.puntos.map(function (p) { return { x: p.anio, y: p.valor }; }),
      };
    });

    var valueLabels = {
      id: "valueLabels",
      afterDatasetsDraw: function (c) {
        var ctx = c.ctx; ctx.save();
        ctx.font = "700 15px 'Bricolage Grotesque',sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        c.data.datasets.forEach(function (d, di) {
          c.getDatasetMeta(di).data.forEach(function (pt, i) {
            ctx.fillStyle = d.borderColor;
            ctx.fillText(fmt(d.data[i].y, dec), pt.x, pt.y - 12);
          });
        });
        ctx.restore();
      },
    };

    if (chart) { chart.destroy(); }
    var ex = DATOS.trayectoria.ejeX || { min: 2016, max: 2026, paso: 2 };
    chart = new window.Chart(canvas.getContext("2d"), {
      type: "line",
      data: { datasets: cfgDatasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 26, right: 20, bottom: 4, left: 4 } },
        scales: {
          x: { type: "linear", min: ex.min, max: ex.max,
            ticks: { stepSize: ex.paso, callback: function (v) { return String(v); }, font: { size: 13 } },
            grid: { color: "#EFEBE1" }, border: { color: "#C8C1B2" } },
          y: { min: serie.ejeY.min, max: serie.ejeY.max,
            ticks: { stepSize: serie.ejeY.paso, callback: function (v) { return fmt(v, dec); }, font: { size: 13 } },
            grid: { color: "#E7E2D6" }, border: { color: "#C8C1B2" },
            title: { display: true, text: serie.ejeY.titulo, color: "#5C554A", font: { size: 13 } } },
        },
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + ": " + fmt(c.parsed.y, dec); } } } },
      },
      plugins: [valueLabels],
    });
  }

  function setMetric(m) {
    if (m === metric) return;
    metric = m;
    q("[data-metric-btn]").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-metric-btn") === m);
    });
    renderPanorama(); renderChart();
  }

  q("[data-metric-btn]").forEach(function (b) {
    b.addEventListener("click", function () { setMetric(b.getAttribute("data-metric-btn")); });
  });

  if (window.Chart) { window.Chart.defaults.font.family = "'Bricolage Grotesque','Segoe UI',sans-serif"; window.Chart.defaults.color = "#948C7E"; }
  renderPanorama();
  renderChart();
})();
