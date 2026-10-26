/* Portal Huella Tequila — hidrata los resultados (reparto por etapa, huella por litro, evolución,
   fuentes) desde #datos y la interacción de la página (pilares, menú, revelados). */
(function () {
  "use strict";
  var DATOS = JSON.parse(document.getElementById("datos").textContent);
  var ciclo = DATOS.ciclo || {};
  var faseInfo = {};
  (DATOS.catalogoFases || []).forEach(function (f) { faseInfo[f.id] = f; });

  var metric = "carbono";
  var chart = null;
  var fuentesChart = null;

  // --- Cifras tipo "calculadora" de la presentación de la ESCAT (CRT–CMM), por año -----------
  // Carbono: barra por ALCANCE 1/2/3; Agua: por componente azul/verde/gris.
  // Solo los años listados tienen cifra por litro; en los demás se muestra únicamente el reparto
  // por etapa (no se derivan años con factores). Las cifras se copian literal de la lámina, sin
  // ajustarlas: los alcances suman 6,44 frente al total rotulado de 6,54.
  // Los % de las fuentes son los de la lámina; "Otras fuentes" es el resto hasta el 100 %.
  // Origen: lámina 11 de la presentación de la ESCAT (CRT–CMM).
  var CALC = {
    2025: {
      carbono: {
        unidad: "kg CO₂e", ref: "1 L a 40 % Alc. vol.", dec: 2, totalDec: 2, pctDec: 2,
        equivKm: 26, total: 6.54,  // equivalencia literal de la lámina
        grupos: [
          { id: "a1", label: "Alcance 1 · directas", color: "#B89B7E", valor: 2.20 },
          { id: "a2", label: "Alcance 2 · indirectas", color: "#F2C14E", valor: 1.04 },
          { id: "a3", label: "Alcance 3 · indirectas", color: "#4FB3A6", valor: 3.20 },
        ],
        categorias: [
          { nombre: "Botella de vidrio", pct: 35.45, grupo: "a3", color: "#4FB3A6" },
          { nombre: "Transporte de tequila", pct: 25.30, grupo: "a3", color: "#2E7F86" },
          { nombre: "Combustóleo", pct: 14.31, grupo: "a1", color: "#B89B7E" },
          { nombre: "Electricidad", pct: 7.31, grupo: "a2", color: "#E0A93E" },
          { nombre: "Otras fuentes", pct: 17.63, grupo: null, color: "#C8C1B2" },
        ],
      },
      agua: {
        unidad: "L / L", ref: "1 L a 40 % Alc. vol.", dec: 2, totalDec: 0, pctDec: 0,
        total: 15,
        grupos: [
          { id: "verde", label: "Agua verde", color: "#7FA65B", valor: 12.45 },
          { id: "gris", label: "Agua gris", color: "#948C7E", valor: 1.95 },
          { id: "azul", label: "Agua azul", color: "#4C8C9E", valor: 0.60 },
        ],
        categorias: [
          { nombre: "Agua verde (lluvia, cultivo de agave)", pct: 83, grupo: "verde", color: "#7FA65B" },
          { nombre: "Agua gris (tratamiento, vinazas)", pct: 13, grupo: "gris", color: "#948C7E" },
          { nombre: "Agua azul (pozo: riego y procesos)", pct: 4, grupo: "azul", color: "#4C8C9E" },
        ],
      },
    },
  };

  // Cifras del año visible para una métrica; null si ese año no tiene cifra por litro.
  function calcDatos(met) {
    var anio = CALC[ciclo.anio];
    var base = anio && anio[met];
    if (!base) return null;
    var cats = base.categorias.map(function (c) {
      return { nombre: c.nombre, pct: c.pct, grupo: c.grupo, color: c.color };  // la lámina solo da %
    });
    var sumaGrupos = base.grupos.reduce(function (s, g) { return s + g.valor; }, 0);
    return { base: base, cats: cats, grupos: base.grupos, total: base.total, sumaGrupos: sumaGrupos };
  }

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Video del hero: sin movimiento si el usuario lo pidió.
  var heroVideo = document.querySelector(".hero-video");
  if (heroVideo && reduceMotion) { heroVideo.removeAttribute("autoplay"); heroVideo.pause(); }

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

  // Panorama scroll-driven (rail sticky): primero la escena A (reparto por etapa) y, al seguir
  // bajando, cede su lugar a la escena B (cifra por litro), que apila alcances y luego fuentes.
  (function initPanoramaRail() {
    var rail = document.querySelector('[data-rail="b1"]');
    if (!rail) return;
    var escenaFases = rail.querySelector('[data-escena="fases"]');
    var escenaCalc = rail.querySelector('[data-escena="calc"]');
    var filas = ["fases", "alcances", "fuentes"].map(function (k) {
      return rail.querySelector('[data-b1-row="' + k + '"]');
    });
    var dots = rail.querySelectorAll(".b1-dots span");
    var narrow = window.matchMedia && window.matchMedia("(max-width: 1023px)").matches;
    if (escenaCalc && !hayCalc) escenaCalc.hidden = true;
    if (reduceMotion || narrow || !escenaFases || !escenaCalc) {  // móvil / sin animación: escenas apiladas
      filas.forEach(function (f) { if (f) f.classList.add("is-in"); });
      return;
    }
    rail.classList.add("rail-on");
    // Pasos: 0 A (ilustración) · 1 A (reparto por etapa) · 2 B (cifra + alcances) · 3 B (fuentes).
    // Sin cifra por litro el rail se acorta y se queda en la escena A.
    var pasos = hayCalc ? [0, 0.1, 0.42, 0.66] : [0, 0.2];
    if (!hayCalc) {
      escenaCalc.hidden = true;
      rail.classList.add("rail-corto");
      for (var k = 2; k < dots.length; k++) dots[k].hidden = true;
    }
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
        pasos.forEach(function (t, i) { if (p >= t) step = i; });
        escenaFases.classList.toggle("is-off", step >= 2);
        escenaCalc.classList.toggle("is-off", step < 2);
        filas.forEach(function (f, i) { if (f) f.classList.toggle("is-in", step >= [1, 2, 3][i]); });
        dots.forEach(function (d, i) { d.classList.toggle("on", i <= step); });
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
  })();

  // Decimales fijos con coma decimal (2,20 · 1,04 · 3,20, como en la lámina).
  function fmt(v, dec) {
    return Number(v).toFixed(dec == null ? 2 : dec).replace(".", ",");
  }
  function q(sel) { return document.querySelectorAll(sel); }
  function setText(sel, txt) { q(sel).forEach(function (n) { n.textContent = txt; }); }
  function hexToRgba(hex, a) {
    var h = (hex || "#948C7E").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  function grupoLabel(d, id) {
    var g = d.grupos.filter(function (x) { return x.id === id; })[0];
    return g ? g.label.split(" · ")[0] : "";
  }
  // ¿El año visible tiene cifra por litro? Si no, se ocultan la escena B y "Fuentes por fase".
  var hayCalc = !!CALC[ciclo.anio];
  if (!hayCalc) q("[data-requiere-calc]").forEach(function (n) { n.hidden = true; });

  var scopeChart = null, sourcesChart = null;
  var serieSel = 0;  // serie/alcance mostrado en la gráfica de EVOLUCIÓN (siempre una sola)

  // Selector de serie para la gráfica de líneas por año: muestra una sola línea a la vez
  // (sin opción combinada "Todas"; solo se permite un estilo de gráfica).
  function renderSerieSelect() {
    var cont = document.querySelector("[data-serie-select]");
    if (!cont) return;
    var serie = (DATOS.trayectoria || {}).series ? DATOS.trayectoria.series[metric] : null;
    if (!serie || !serie.datasets || serie.datasets.length < 2) { cont.innerHTML = ""; return; }
    var esAgua = metric === "agua";
    if (serieSel == null || serieSel < 0 || serieSel >= serie.datasets.length) serieSel = 0;
    var html = '<span class="year-select-label">' + (esAgua ? "SERIE" : "ALCANCE") + '</span>';
    serie.datasets.forEach(function (ds, i) {
      html += '<button type="button" class="year-btn' + (serieSel === i ? " is-active" : "") +
        '" data-serie="' + i + '" aria-pressed="' + (serieSel === i) + '">' + ds.label + "</button>";
    });
    cont.innerHTML = html;
    cont.querySelectorAll("[data-serie]").forEach(function (b) {
      b.addEventListener("click", function () {
        serieSel = parseInt(b.getAttribute("data-serie"), 10);
        renderSerieSelect();
        renderChart();
      });
    });
  }

  // Etiqueta el valor dentro de cada segmento de la barra apilada (estilo calculadora).
  function barSegLabels(dec) {
    return { id: "barSegLabels", afterDatasetsDraw: function (c) {
      var ctx = c.ctx; ctx.save();
      ctx.font = "700 12px 'Bricolage Grotesque',sans-serif"; ctx.fillStyle = "#1F1A14";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      c.data.datasets.forEach(function (ds, di) {
        var el = c.getDatasetMeta(di).data[0];
        if (!el || !(ds.data[0] > 0) || Math.abs(el.x - el.base) < 34) return;
        var ctr = el.getCenterPoint();  // centro del segmento (el.x es su borde derecho)
        ctx.fillText(fmt(ds.data[0], dec), ctr.x, ctr.y);
      });
      ctx.restore();
    } };
  }
  // Etiqueta el % (literal de la lámina) al final de cada barra de fuentes.
  function pctBarLabels(pcts, dec) {
    return { id: "pctBarLabels", afterDatasetsDraw: function (c) {
      var ctx = c.ctx; ctx.save();
      ctx.font = "700 12px 'Bricolage Grotesque',sans-serif"; ctx.fillStyle = "#2A241C";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      c.getDatasetMeta(0).data.forEach(function (el, i) {
        ctx.fillText(fmt(pcts[i], dec) + " %", el.x + 6, el.y);
      });
      ctx.restore();
    } };
  }

  function renderPanorama() {
    var d = calcDatos(metric);
    var esAgua = metric === "agua";

    setText("[data-panorama-titulo]", esAgua
      ? "HUELLA HÍDRICA DE LA CADENA AGAVE–TEQUILA"
      : "HUELLA DE CARBONO DE LA CADENA AGAVE–TEQUILA");
    setText("[data-scope-caption]", esAgua ? "Por componente del agua" : "Por alcance de emisión");

    var ref = document.querySelector("[data-calc-ref]");
    var equiv = document.querySelector("[data-calc-equiv]");
    var rows = q('[data-escena="calc"] [data-b1-row]');

    if (!d) return;  // año sin cifra por litro: la escena B está oculta
    rows.forEach(function (r) { r.hidden = false; });
    // En agua, "principales fuentes" repetiría la barra por componente: se omite.
    var filaFuentes = document.querySelector('[data-escena="calc"] [data-b1-row="fuentes"]');
    if (filaFuentes) filaFuentes.hidden = esAgua;

    setText("[data-calc-num]", fmt(d.total, d.base.totalDec));
    setText("[data-calc-unit]", d.base.unidad);
    if (ref) { ref.hidden = false; ref.textContent = "Ref: " + d.base.ref + " · " + ciclo.anio; }

    if (equiv) {
      if (d.base.equivKm) {
        equiv.hidden = false;
        equiv.innerHTML = "Equivalente a conducir un automóvil promedio a gasolina por aproximadamente <strong>" +
          d.base.equivKm + " km</strong>.";
      } else { equiv.hidden = true; }
    }

    // Barra apilada por alcance/componente (Chart.js) + leyenda HTML.
    var legend = document.querySelector("[data-scope-legend]");
    if (legend) {
      legend.innerHTML = "";
      d.grupos.forEach(function (g) {
        if (g.valor <= 0) return;
        var it = document.createElement("span"); it.className = "item";
        it.innerHTML = '<span class="dot" style="background:' + g.color + '"></span>' + g.label +
          ' <span class="muted small">' + fmt(g.valor, d.base.dec) + "</span>";
        legend.appendChild(it);
      });
    }
    var scopeCanvas = document.getElementById("scope-chart");
    if (scopeCanvas && window.Chart) {
      if (scopeChart) scopeChart.destroy();
      var grupos = d.grupos.filter(function (g) { return g.valor > 0; });
      scopeChart = new window.Chart(scopeCanvas.getContext("2d"), {
        type: "bar",
        data: { labels: [""], datasets: grupos.map(function (g) {
          return { label: g.label, data: [g.valor], backgroundColor: g.color, borderWidth: 0, stack: "s" };
        }) },
        options: {
          indexAxis: "y", responsive: true, maintainAspectRatio: false, layout: { padding: 0 },
          scales: { x: { stacked: true, display: false, max: d.sumaGrupos }, y: { stacked: true, display: false } },
          plugins: { legend: { display: false },
            tooltip: { callbacks: { label: function (c) { return c.dataset.label + ": " + fmt(c.parsed.x, d.base.dec); } } } },
        },
        plugins: [barSegLabels(d.base.dec)],
      });
    }

    // Principales fuentes (Chart.js, barra horizontal) — las de la lámina, de mayor a menor, en %
    // literal; el resto ("Otras fuentes", sin alcance) solo aparece en Fuentes por fase.
    var srcCanvas = document.getElementById("sources-chart");
    if (srcCanvas && window.Chart) {
      if (sourcesChart) { sourcesChart.destroy(); sourcesChart = null; }
      if (!esAgua) {
        var top = d.cats.filter(function (c) { return c.grupo; })
          .sort(function (a, b) { return b.pct - a.pct; });
        var gc = {}; d.grupos.forEach(function (g) { gc[g.id] = g.color; });
        sourcesChart = new window.Chart(srcCanvas.getContext("2d"), {
          type: "bar",
          data: { labels: top.map(function (c) { return c.nombre; }),
            datasets: [{ data: top.map(function (c) { return c.pct; }),
              backgroundColor: top.map(function (c) { return gc[c.grupo] || c.color; }),
              borderWidth: 0, borderRadius: 8, barThickness: 12 }] },
          options: {
            indexAxis: "y", responsive: true, maintainAspectRatio: false, layout: { padding: { right: 62 } },
            scales: { x: { display: false, max: 100 },
              y: { ticks: { font: { size: 12 }, color: "#2A241C" }, grid: { display: false }, border: { display: false } } },
            plugins: { legend: { display: false },
              tooltip: { callbacks: { label: function (c) { return fmt(top[c.dataIndex].pct, d.base.pctDec) + " % de la huella"; } } } },
          },
          plugins: [pctBarLabels(top.map(function (c) { return c.pct; }), d.base.pctDec)],
        });
      }
    }
  }

  // Escena A: reparto de la huella por etapa de la cadena (BD, ciclo.metricas.porFase). Solo
  // porcentajes: el total de la BD (ilustrativo) no coincide con la cifra por litro de la escena B.
  function renderFases() {
    var m = (ciclo.metricas || {})[metric];
    var esAgua = metric === "agua";
    setText("[data-fases-titulo]", esAgua
      ? "¿En qué etapa de la cadena se usa el agua?"
      : "¿En qué etapa de la cadena se genera la huella?");
    var fila = document.querySelector('[data-b1-row="fases"]');
    var split = document.querySelector("[data-split]");
    var legend = document.querySelector("[data-fases-legend]");
    if (!fila || !split || !legend) return;
    var reparto = m && m.porFase ? m.porFase.filter(function (pf) { return pf.pct > 0; }) : [];
    fila.hidden = !reparto.length;
    if (!reparto.length) return;
    split.innerHTML = ""; legend.innerHTML = "";
    var resumen = [];
    reparto.forEach(function (pf) {
      var f = faseInfo[pf.fase] || { nombre: pf.fase, mayus: pf.fase, color: "#C8C1B2" };
      var seg = document.createElement("div");
      seg.className = "seg";
      seg.style.width = pf.pct + "%";
      seg.style.background = f.color;
      seg.textContent = pf.pct >= 8 ? pf.pct + " %" : "";
      seg.title = f.nombre + ": " + pf.pct + " %";
      split.appendChild(seg);
      var it = document.createElement("span");
      it.className = "item";
      it.innerHTML = '<span class="dot" style="background:' + f.color + '"></span>' + f.mayus +
        ' <span class="muted small">' + pf.pct + " %</span>";
      legend.appendChild(it);
      resumen.push(f.nombre + " " + pf.pct + " %");
    });
    split.setAttribute("aria-label", "Reparto por etapa de la cadena: " + resumen.join(", "));
    setText("[data-fases-nota]", "Participación de cada etapa en la " +
      (esAgua ? "huella hídrica" : "huella de carbono") + " por litro de tequila · " + ciclo.anio + ".");
  }

  function renderChart() {
    var serie = (DATOS.trayectoria || {}).series ? DATOS.trayectoria.series[metric] : null;
    var canvas = document.getElementById("trayectoria-chart");
    var hayPuntos = !!(serie && serie.datasets.some(function (ds) { return ds.puntos.length; }));
    if (canvas) canvas.parentNode.hidden = !(hayPuntos && window.Chart);
    if (!hayPuntos || !canvas || !window.Chart) return;
    var dec = metric === "agua" ? 0 : 2;

    setText("[data-ch-titulo]", (metric === "agua" ? "Huella hídrica" : "Huella de carbono") +
      " por cada litro de tequila a 40 % Alc. Vol.");
    setText("[data-ch-nota]", serie.nota || "");

    // Siempre una sola línea (la serie/alcance elegido); no se permite la vista combinada.
    var datasets = [serie.datasets[serieSel] || serie.datasets[0]];

    var legend = document.querySelector("[data-ch-legend]");
    legend.innerHTML = "";
    datasets.forEach(function (ds) {
      var it = document.createElement("span");
      it.className = "item";
      it.innerHTML = '<span class="dot" style="background:' + ds.color + '"></span>' + ds.label;
      legend.appendChild(it);
    });

    // Marcas del eje X solo en los años con dato (2015 · 2020 · 2025), no en un paso fijo.
    var anios = [];
    serie.datasets.forEach(function (ds) {
      ds.puntos.forEach(function (p) { if (anios.indexOf(p.anio) < 0) anios.push(p.anio); });
    });
    anios.sort();

    var cfgDatasets = datasets.map(function (ds) {
      return {
        label: ds.label, borderColor: ds.color, backgroundColor: hexToRgba(ds.color, 0.12),
        pointBackgroundColor: ds.color, pointBorderColor: "#fff", pointBorderWidth: 2,
        pointRadius: 6, borderWidth: 3, tension: 0.25, fill: true,
        data: ds.puntos.map(function (p) { return { x: p.anio, y: p.valor }; }),
      };
    });

    var valueLabels = {
      id: "valueLabels",
      afterDatasetsDraw: function (c) {
        var ctx = c.ctx; ctx.save();
        ctx.font = "700 15px 'Bricolage Grotesque',sans-serif";
        ctx.textAlign = "center";
        var pts = [];
        c.data.datasets.forEach(function (d, di) {
          c.getDatasetMeta(di).data.forEach(function (pt, i) { pts.push({ pt: pt, d: d, i: i }); });
        });
        pts.forEach(function (p) {
          // Si otro punto del mismo año queda a menos de 24 px por encima, la etiqueta va debajo.
          var abajo = pts.some(function (o) {
            return o !== p && Math.abs(o.pt.x - p.pt.x) < 1 && o.pt.y < p.pt.y && p.pt.y - o.pt.y < 24;
          });
          ctx.fillStyle = p.d.borderColor;
          ctx.textBaseline = abajo ? "top" : "bottom";
          ctx.fillText(fmt(p.d.data[p.i].y, dec), p.pt.x, abajo ? p.pt.y + 12 : p.pt.y - 12);
        });
        ctx.restore();
      },
    };

    if (chart) { chart.destroy(); }
    var ex = DATOS.trayectoria.ejeX || { min: 2015, max: 2025, paso: 5 };
    chart = new window.Chart(canvas.getContext("2d"), {
      type: "line",
      data: { datasets: cfgDatasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 26, right: 28, bottom: 4, left: 12 } },
        scales: {
          x: { type: "linear", min: ex.min - 0.8, max: ex.max + 0.8,
            afterBuildTicks: function (axis) {
              if (anios.length) axis.ticks = anios.map(function (a) { return { value: a }; });
            },
            ticks: { callback: function (v) { return String(v); }, font: { size: 13 } },
            grid: { color: "#EFEBE1" }, border: { color: "#C8C1B2" } },
          y: { min: serie.ejeY.min, max: serie.ejeY.max,
            ticks: { stepSize: serie.ejeY.paso, callback: function (v) { return fmt(v, metric === "agua" ? 0 : 1); }, font: { size: 13 } },
            grid: { color: "#E7E2D6" }, border: { color: "#C8C1B2" },
            title: { display: true, text: serie.ejeY.titulo, color: "#5C554A", font: { size: 13 } } },
        },
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + ": " + fmt(c.parsed.y, dec); } } } },
      },
      plugins: [valueLabels],
    });
  }

  // Fuentes: dona (Chart.js) + lista con alcance y % literal (incluye el resto hasta el 100 %).
  function renderFuentes() {
    var d = calcDatos(metric);
    var wrap = document.querySelector("[data-fuentes-wrap]");
    var pie = document.querySelector("[data-fuentes-pie]");
    if (!d) return;  // año sin desglose: la sección está oculta
    if (wrap) wrap.hidden = false;
    if (pie) pie.textContent = "Participación de cada fuente en la huella total por litro de tequila · " + ciclo.anio + ".";

    setText("[data-fuentes-total]", fmt(d.total, d.base.totalDec));
    setText("[data-fuentes-unit]", d.base.unidad);
    var ordered = d.cats.slice().sort(function (a, b) {
      if (!a.grupo !== !b.grupo) return a.grupo ? -1 : 1;   // el resto sin alcance, al final
      return b.pct - a.pct;
    });
    var list = document.querySelector("[data-fuentes-list]");
    if (list) {
      list.innerHTML = "";
      ordered.forEach(function (c) {
        var row = document.createElement("div"); row.className = "fl-row";
        var tag = metric === "carbono" && c.grupo ? '<span class="fl-tag">' + grupoLabel(d, c.grupo) + "</span>" : "";
        row.innerHTML = '<span class="fl-dot" style="background:' + c.color + '"></span>' +
          '<span class="fl-name">' + c.nombre + tag + "</span>" +
          '<span class="fl-pct">' + fmt(c.pct, d.base.pctDec) + " %</span>";
        list.appendChild(row);
      });
    }
    var canvas = document.getElementById("fuentes-chart");
    if (!canvas || !window.Chart) return;
    if (fuentesChart) fuentesChart.destroy();
    fuentesChart = new window.Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: { labels: ordered.map(function (c) { return c.nombre; }),
        datasets: [{ data: ordered.map(function (c) { return c.pct; }),
          backgroundColor: ordered.map(function (c) { return c.color; }), borderWidth: 2, borderColor: "#fff" }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "62%",
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) {
            return ctx.label + ": " + fmt(ordered[ctx.dataIndex].pct, d.base.pctDec) + " %"; } } } },
      },
    });
  }

  // ---- Plotly: Sankey + Treemaps por fase (portados del mockup de la plataforma CRT) ----
  var crtC = {
    dark: "rgb(39, 93, 110)", accent: "rgb(93, 140, 143)", action: "rgb(198, 112, 72)",
    subtle: "rgb(128, 128, 128)", border: "#e2e8f0",
    tAccent: "rgba(93, 140, 143, 0.25)", tDark: "rgba(39, 93, 110, 0.25)", tSubtle: "rgba(128, 128, 128, 0.2)",
  };
  var FASE_DATA = {
    carbono: {
      unidad: "kg",
      agro: { labels: ["Diésel agrícola", "Fertilizante (N)", "Pesticidas", "Fert. orgánico"], values: [0.50, 0.17, 0.07, 0.03],
        colors: [crtC.dark, crtC.accent, crtC.subtle, crtC.border] },
      ind: { labels: ["Combustóleo", "Botellas de vidrio", "Electricidad", "Cajas de cartón"], values: [3.0, 0.85, 0.64, 0.28],
        colors: [crtC.dark, crtC.action, crtC.subtle, crtC.border] },
      sankey: {
        label: ["Fase agrícola", "Fase industrial", "Gestión de residuos", "Combustóleo", "Botellas de vidrio", "Tequila (1 L)"],
        color: [crtC.accent, crtC.dark, crtC.subtle, crtC.border, "#94a3b8", crtC.action],
        source: [0, 3, 4, 1, 2], target: [1, 1, 1, 5, 5], value: [1.42, 3.0, 0.85, 5.27, 1.14],
        linkColor: [crtC.tAccent, "rgba(226, 232, 240, 0.5)", crtC.tSubtle, crtC.tDark, "rgba(203, 213, 225, 0.4)"],
      },
    },
    agua: {
      unidad: "m³",
      agro: { labels: ["Evapotranspiración", "Agua subterránea", "Agroquímicos"], values: [140.6, 3.0, 0.3],
        colors: [crtC.dark, crtC.accent, crtC.border] },
      ind: { labels: ["Vol. de vinazas", "Combustóleo", "Agua de enfriamiento", "Electricidad"], values: [6.0, 1.4, 0.57, 0.28],
        colors: [crtC.dark, crtC.accent, crtC.subtle, crtC.border] },
      sankey: null,
    },
  };

  function drawTreemap(id, cfg, unidad) {
    var el = document.getElementById(id);
    if (!el || !window.Plotly) return;
    var data = [{
      type: "treemap", labels: cfg.labels, parents: cfg.labels.map(function () { return ""; }),
      values: cfg.values, texttemplate: "%{label}<br>%{value} " + unidad, textposition: "middle center",
      marker: { colors: cfg.colors, line: { width: 2, color: "#ffffff" } }, hoverinfo: "label+value",
    }];
    var layout = { margin: { l: 0, r: 0, t: 0, b: 0 }, paper_bgcolor: "transparent",
      font: { size: 13, color: "#ffffff", family: "'Bricolage Grotesque',sans-serif" } };
    if (cfg.colors.indexOf(crtC.border) !== -1) layout.font.color = crtC.dark;
    window.Plotly.newPlot(id, data, layout, { displayModeBar: false, responsive: true });
  }

  function renderSankeyTreemaps() {
    if (!window.Plotly) return;
    var fd = FASE_DATA[metric];
    if (!fd) return;
    setText("[data-fase-sub]", "Distribución de la " + (metric === "agua" ? "huella hídrica" : "huella de carbono") +
      " dentro de las fases agrícola e industrial.");
    drawTreemap("treemap-agro", fd.agro, fd.unidad);
    drawTreemap("treemap-ind", fd.ind, fd.unidad);
    var sankeyWrap = document.querySelector("[data-sankey-wrap]");
    var sankeyEl = document.getElementById("sankey-diagram");
    if (fd.sankey && sankeyEl) {
      if (sankeyWrap) sankeyWrap.hidden = false;
      var s = fd.sankey;
      var sdata = [{
        type: "sankey", orientation: "h",
        node: { pad: 24, thickness: 20, line: { color: "#ffffff", width: 1 }, label: s.label, color: s.color },
        link: { source: s.source, target: s.target, value: s.value, color: s.linkColor },
      }];
      window.Plotly.newPlot("sankey-diagram", sdata,
        { font: { size: 12, color: crtC.dark, family: "'Bricolage Grotesque',sans-serif" },
          paper_bgcolor: "transparent", plot_bgcolor: "transparent", margin: { l: 16, r: 16, t: 16, b: 16 } },
        { displayModeBar: false, responsive: true });
    } else if (sankeyWrap) {
      sankeyWrap.hidden = true;
    }
  }

  function setMetric(m) {
    if (m === metric) return;
    metric = m;
    q("[data-metric-btn]").forEach(function (b) {
      var on = b.getAttribute("data-metric-btn") === m;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    serieSel = 0;               // al cambiar de métrica, mostrar la primera serie
    renderSerieSelect();
    renderFases(); renderPanorama(); renderChart(); renderFuentes(); renderSankeyTreemaps();
  }

  q("[data-metric-btn]").forEach(function (b) {
    b.addEventListener("click", function () { setMetric(b.getAttribute("data-metric-btn")); });
  });

  // Pilares: click en una tarjeta abre su panel de detalle (nivel 2) y lo lleva a la vista.
  (function initPilares() {
    var cards = document.querySelectorAll("[data-pilar]");
    cards.forEach(function (card) {
      card.addEventListener("click", function () {
        var id = card.getAttribute("data-pilar");
        var panel = document.querySelector('[data-pilar-panel="' + id + '"]');
        var abrir = !card.classList.contains("is-active");
        cards.forEach(function (c) { c.classList.remove("is-active"); c.setAttribute("aria-expanded", "false"); });
        document.querySelectorAll("[data-pilar-panel]").forEach(function (p) { p.hidden = true; });
        if (abrir && panel) {
          card.classList.add("is-active");
          card.setAttribute("aria-expanded", "true");
          panel.hidden = false;
          panel.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
          panel.focus({ preventScroll: true });
        }
      });
    });
  })();

  // Menú "Acerca de" (desplegable tipo disclosure): botón abre/cierra; Escape o salir del foco lo cierra.
  (function initDropdown() {
    var drop = document.querySelector(".nav-drop");
    if (!drop) return;
    var btn = drop.querySelector(".nav-drop-btn");
    function cerrar(devolverFoco) {
      drop.classList.remove("open"); btn.setAttribute("aria-expanded", "false");
      if (devolverFoco) btn.focus();
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = drop.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    drop.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && drop.classList.contains("open")) cerrar(true);
    });
    drop.addEventListener("focusout", function (e) {
      if (!drop.contains(e.relatedTarget)) cerrar(false);
    });
    document.addEventListener("click", function () { cerrar(false); });
  })();

  // Menú en pantallas angostas: botón MENÚ despliega los enlaces; un enlace lo vuelve a cerrar.
  (function initMenuMovil() {
    var nav = document.querySelector(".nav");
    var btn = document.querySelector(".nav-toggle");
    if (!nav || !btn) return;
    btn.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.querySelectorAll(".nav-links a").forEach(function (a) {
      a.addEventListener("click", function () {
        nav.classList.remove("is-open"); btn.setAttribute("aria-expanded", "false");
      });
    });
  })();

  if (window.Chart) { window.Chart.defaults.font.family = "'Bricolage Grotesque','Segoe UI',sans-serif"; window.Chart.defaults.color = "#948C7E"; }
  renderSerieSelect();
  renderFases();
  renderPanorama();
  renderChart();
  renderFuentes();
  renderSankeyTreemaps();
  // Chart.js mide las etiquetas con la fuente disponible al dibujar; al cargar la fuente web se
  // vuelve a dibujar para que no queden recortadas.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { renderPanorama(); renderChart(); renderFuentes(); });
  }
})();
