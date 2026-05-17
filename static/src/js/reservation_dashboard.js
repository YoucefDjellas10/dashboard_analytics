/** @odoo-module **/

import { registry }   from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Component, onWillStart, useState } from "@odoo/owl";

export class ReservationDashboard extends Component {

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        const currentYear = new Date().getFullYear();

        const years = [];
        for (let y = currentYear; y >= currentYear - 5; y--) {
            years.push(y);
        }

        this.state = useState({
            loading       : false,
            zones         : [],
            selected_zone : "",
            rows          : [],
            annee_n       : currentYear,
            annee_n1      : currentYear - 1,
            pie_data      : [],
            pie_data_n1   : [],
            years         : years,
        });

        onWillStart(() => this._loadZones().then(() => this.loadData()));
    }

    // ─────────────────────────────────────────
    //  Utilitaires
    // ─────────────────────────────────────────

    _pad(n) { return String(n).padStart(2, "0"); }

    _formatORM(d) {
        return `${d.getFullYear()}-${this._pad(d.getMonth()+1)}-${this._pad(d.getDate())} `
             + `${this._pad(d.getHours())}:${this._pad(d.getMinutes())}:${this._pad(d.getSeconds())}`;
    }

    async _loadZones() {
        this.state.zones = await this.orm.searchRead(
            "zone", [], ["id", "name"], { order: "name asc" }
        );
    }

    _buildDomain(annee, mois) {
        const debut = new Date(annee, mois - 1, 1,  0,  0,  0);
        const fin   = new Date(annee, mois,     0, 23, 59, 59);
        const domain = [
            ["status",      "=",  "confirmee"],
            ["create_date", ">=", this._formatORM(debut)],
            ["create_date", "<=", this._formatORM(fin)],
        ];
        if (this.state.selected_zone)
            domain.push(["zone", "=", parseInt(this.state.selected_zone)]);
        return domain;
    }

    // ─────────────────────────────────────────
    //  Chargement
    // ─────────────────────────────────────────

    async loadData() {
        this.state.loading = true;
        try {
            const n  = this.state.annee_n;
            const n1 = this.state.annee_n1;

            const MOIS_LABELS = [
                "Janvier","Février","Mars","Avril","Mai","Juin",
                "Juillet","Août","Septembre","Octobre","Novembre","Décembre"
            ];

            const _buildDomainYear = (annee) => {
                const debut = new Date(annee, 0,  1,  0,  0,  0);
                const fin   = new Date(annee, 11, 31, 23, 59, 59);
                const domain = [
                    ["status",      "=",  "confirmee"],
                    ["create_date", ">=", this._formatORM(debut)],
                    ["create_date", "<=", this._formatORM(fin)],
                ];
                if (this.state.selected_zone)
                    domain.push(["zone", "=", parseInt(this.state.selected_zone)]);
                return domain;
            };

            const [recsN1, recsN] = await Promise.all([
                this.orm.searchRead(
                    "reservation",
                    _buildDomainYear(n1),
                    ["create_date", "nbr_jour_reservation"],
                    { limit: 0 }
                ),
                this.orm.searchRead(
                    "reservation",
                    _buildDomainYear(n),
                    ["create_date", "nbr_jour_reservation"],
                    { limit: 0 }
                ),
            ]);

            const groupByMonth = (recs) => {
                const countArr = new Array(12).fill(0);
                const joursArr = new Array(12).fill(0);
                for (const r of recs) {
                    if (!r.create_date) continue;
                    const moisIdx = new Date(r.create_date).getMonth();
                    countArr[moisIdx]++;
                    joursArr[moisIdx] += (r.nbr_jour_reservation || 0);
                }
                return { countArr, joursArr };
            };

            const grpN1 = groupByMonth(recsN1);
            const grpN  = groupByMonth(recsN);

            const rows = [];
            for (let m = 1; m <= 12; m++) {
                const idx = m - 1;

                const count_n1 = grpN1.countArr[idx];
                const jours_n1 = grpN1.joursArr[idx];
                const count_n  = grpN.countArr[idx];
                const jours_n  = grpN.joursArr[idx];

                let delta = null;
                if (count_n1 > 0) {
                    delta = Math.round(((count_n - count_n1) / count_n1) * 100);
                } else if (count_n > 0) {
                    delta = 100;
                }

                let delta_jours = null;
                if (jours_n1 > 0) {
                    delta_jours = Math.round(((jours_n - jours_n1) / jours_n1) * 100);
                } else if (jours_n > 0) {
                    delta_jours = 100;
                }

                rows.push({
                    mois: m, label: MOIS_LABELS[m - 1],
                    count_n1, jours_n1,
                    count_n,  jours_n,
                    delta, delta_jours,
                });
            }

            this.state.rows = rows;

        } finally {
            await Promise.all([this._loadPieData(), this._loadPieDataN1()]);
            this.state.loading = false;
            setTimeout(() => {
                this._renderChart();
                this._renderChartLine();
                this._renderChartPie();
                this._renderChartPieN1();
            }, 50);
        }
    }

    // ─────────────────────────────────────────
    //  Handlers
    // ─────────────────────────────────────────

    updateSelectedZone(ev) {
        this.state.selected_zone = ev.target.value;
        this.loadData();
    }

    updateSelectedYear(ev) {
        const annee_n = parseInt(ev.target.value);
        this.state.annee_n  = annee_n;
        this.state.annee_n1 = annee_n - 1;
        this.loadData();
    }

    retourDashboard() {
        this.action.doAction("dashboard_analytics.action_dashboard_statistiques");
    }

    // ─────────────────────────────────────────
    //  MODIFICATION : lecture via data-* pour
    //  éviter la perte de contexte avec arrow fn
    // ─────────────────────────────────────────
    onClickMois(ev) {
        const td   = ev.currentTarget;
        const annee = parseInt(td.dataset.annee);
        const mois  = parseInt(td.dataset.mois);

        const debut = new Date(annee, mois - 1, 1,  0,  0,  0);
        const fin   = new Date(annee, mois,     0, 23, 59, 59);
        const label = `${this.state.rows[mois - 1]?.label} ${annee}`;

        const domain = [
            ["status",      "=",  "confirmee"],
            ["create_date", ">=", this._formatORM(debut)],
            ["create_date", "<=", this._formatORM(fin)],
        ];
        if (this.state.selected_zone)
            domain.push(["zone", "=", parseInt(this.state.selected_zone)]);

        // Navigation vers le composant détail (nouvelle page, pas popup)
        this.action.doAction({
            type   : "ir.actions.client",
            tag    : "dashboard_analytics.action_reservation_detail_dashboard",
            name   : `Détail — ${label}`,
            target : "current",
            params : { domain, label, annee, mois },
        });
    }

    _renderChart() {
        const canvas = document.getElementById("rd-chart");
        if (!canvas) return;

        if (this._chart) {
            this._chart.destroy();
            this._chart = null;
        }

        const labels   = this.state.rows.map(r => r.label);
        const dataN1   = this.state.rows.map(r => r.count_n1);
        const dataN    = this.state.rows.map(r => r.count_n);

        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
        script.onload = () => {
            this._chart = new Chart(canvas, {
                type: "bar",
                data: {
                    labels,
                    datasets: [
                        {
                            label           : String(this.state.annee_n1),
                            data            : dataN1,
                            backgroundColor : "rgba(21, 101, 192, 0.75)",
                            borderRadius    : 6,
                            borderSkipped   : false,
                        },
                        {
                            label           : String(this.state.annee_n),
                            data            : dataN,
                            backgroundColor : "rgba(106, 27, 154, 0.75)",
                            borderRadius    : 6,
                            borderSkipped   : false,
                        },
                    ],
                },
                options: {
                    responsive         : true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            position : "top",
                            labels   : { font: { weight: "bold" } },
                        },
                        tooltip: {
                            callbacks: {
                                label: ctx => ` ${ctx.dataset.label} : ${ctx.parsed.y} réservations`,
                            },
                        },
                        datalabels: false,
                    },
                    scales: {
                        x: {
                            grid : { display: false },
                            ticks: { font: { weight: "600" } },
                        },
                        y: {
                            beginAtZero : true,
                            grid        : { color: "rgba(0,0,0,.06)" },
                            ticks       : { stepSize: 1, font: { weight: "600" } },
                        },
                    },
                },
            });
        };

        if (window.Chart) {
            script.onload();
        } else {
            document.head.appendChild(script);
        }
    }

    _renderChartLine() {
        const canvas = document.getElementById("rd-chart-line");
        if (!canvas) return;

        if (this._chartLine) {
            this._chartLine.destroy();
            this._chartLine = null;
        }

        const labels = this.state.rows.map(r => r.label);
        const dataN1 = this.state.rows.map(r => r.count_n1);
        const dataN  = this.state.rows.map(r => r.count_n);

        const draw = () => {
            this._chartLine = new Chart(canvas, {
                type: "line",
                data: {
                    labels,
                    datasets: [
                        {
                            label           : String(this.state.annee_n1),
                            data            : dataN1,
                            borderColor     : "rgba(21, 101, 192, 1)",
                            backgroundColor : "rgba(21, 101, 192, 0.1)",
                            borderWidth     : 3,
                            pointRadius     : 5,
                            pointHoverRadius: 7,
                            fill            : true,
                            tension         : 0.4,
                        },
                        {
                            label           : String(this.state.annee_n),
                            data            : dataN,
                            borderColor     : "rgba(106, 27, 154, 1)",
                            backgroundColor : "rgba(106, 27, 154, 0.1)",
                            borderWidth     : 3,
                            pointRadius     : 5,
                            pointHoverRadius: 7,
                            fill            : true,
                            tension         : 0.4,
                        },
                    ],
                },
                options: {
                    responsive          : true,
                    maintainAspectRatio : true,
                    plugins: {
                        legend: {
                            position : "top",
                            labels   : { font: { weight: "bold" } },
                        },
                        tooltip: {
                            callbacks: {
                                label: ctx => ` ${ctx.dataset.label} : ${ctx.parsed.y} réservations`,
                            },
                        },
                    },
                    scales: {
                        x: {
                            grid : { display: false },
                            ticks: { font: { weight: "600" } },
                        },
                        y: {
                            beginAtZero : true,
                            grid        : { color: "rgba(0,0,0,.06)" },
                            ticks       : { stepSize: 1, font: { weight: "600" } },
                        },
                    },
                },
            });
        };

        if (window.Chart) {
            draw();
        } else {
            const script = document.createElement("script");
            script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
            script.onload = draw;
            document.head.appendChild(script);
        }
    }

    async _loadPieData() {
        const n     = this.state.annee_n;
        const debut = new Date(n, 0,  1,  0,  0,  0);
        const fin   = new Date(n, 11, 31, 23, 59, 59);

        const zones = await this.orm.searchRead("zone", [], ["id", "name"], { order: "name asc" });

        const promises = zones.map(z =>
            this.orm.readGroup("reservation", [
                ["status",      "=",  "confirmee"],
                ["create_date", ">=", this._formatORM(debut)],
                ["create_date", "<=", this._formatORM(fin)],
                ["zone",        "=",  z.id],
            ], ["id:count"], [])
        );

        const results = await Promise.all(promises);

        this.state.pie_data = zones.map((z, i) => ({
            zone_name : z.name,
            count     : results[i][0]?.__count ?? 0,
        })).filter(r => r.count > 0);
    }

    async _loadPieDataN1() {
        const n1    = this.state.annee_n1;
        const debut = new Date(n1, 0,  1,  0,  0,  0);
        const fin   = new Date(n1, 11, 31, 23, 59, 59);

        const zones = await this.orm.searchRead("zone", [], ["id", "name"], { order: "name asc" });

        const promises = zones.map(z =>
            this.orm.readGroup("reservation", [
                ["status",      "=",  "confirmee"],
                ["create_date", ">=", this._formatORM(debut)],
                ["create_date", "<=", this._formatORM(fin)],
                ["zone",        "=",  z.id],
            ], ["id:count"], [])
        );

        const results = await Promise.all(promises);

        this.state.pie_data_n1 = zones.map((z, i) => ({
            zone_name : z.name,
            count     : results[i][0]?.__count ?? 0,
        })).filter(r => r.count > 0);
    }

    _renderChartPie() {
        const canvas = document.getElementById("rd-chart-pie");
        if (!canvas) return;

        if (this._chartPie) {
            this._chartPie.destroy();
            this._chartPie = null;
        }

        const labels = this.state.pie_data.map(r => r.zone_name);
        const data   = this.state.pie_data.map(r => r.count);

        const COLORS = [
            "rgba(21,101,192,0.85)","rgba(106,27,154,0.85)","rgba(22,163,74,0.85)",
            "rgba(220,38,38,0.85)","rgba(234,179,8,0.85)","rgba(14,116,144,0.85)",
            "rgba(249,115,22,0.85)","rgba(99,102,241,0.85)",
        ];

        const draw = () => {
            this._chartPie = new Chart(canvas, {
                type : "pie",
                data : {
                    labels,
                    datasets: [{
                        data,
                        backgroundColor : COLORS.slice(0, labels.length),
                        borderWidth     : 2,
                        borderColor     : "#fff",
                    }],
                },
                options: {
                    responsive : true,
                    plugins    : {
                        legend: {
                            position : "bottom",
                            labels   : { font: { weight: "600" }, padding: 16 },
                        },
                        tooltip: {
                            callbacks: {
                                label: ctx => ` ${ctx.label} : ${ctx.parsed} réservations`,
                            },
                        },
                    },
                },
            });
        };

        if (window.Chart) { draw(); }
        else {
            const script = document.createElement("script");
            script.src   = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
            script.onload = draw;
            document.head.appendChild(script);
        }
    }

    _renderChartPieN1() {
        const canvas = document.getElementById("rd-chart-pie-n1");
        if (!canvas) return;

        if (this._chartPieN1) {
            this._chartPieN1.destroy();
            this._chartPieN1 = null;
        }

        const labels = this.state.pie_data_n1.map(r => r.zone_name);
        const data   = this.state.pie_data_n1.map(r => r.count);

        const COLORS = [
            "rgba(21,101,192,0.85)","rgba(106,27,154,0.85)","rgba(22,163,74,0.85)",
            "rgba(220,38,38,0.85)","rgba(234,179,8,0.85)","rgba(14,116,144,0.85)",
            "rgba(249,115,22,0.85)","rgba(99,102,241,0.85)",
        ];

        const draw = () => {
            this._chartPieN1 = new Chart(canvas, {
                type : "pie",
                data : {
                    labels,
                    datasets: [{
                        data,
                        backgroundColor : COLORS.slice(0, labels.length),
                        borderWidth     : 2,
                        borderColor     : "#fff",
                    }],
                },
                options: {
                    responsive : true,
                    plugins    : {
                        legend: {
                            position : "bottom",
                            labels   : { font: { weight: "600" }, padding: 16 },
                        },
                        tooltip: {
                            callbacks: {
                                label: ctx => ` ${ctx.label} : ${ctx.parsed} réservations`,
                            },
                        },
                    },
                },
            });
        };

        if (window.Chart) { draw(); }
        else {
            const script = document.createElement("script");
            script.src   = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
            script.onload = draw;
            document.head.appendChild(script);
        }
    }

    // ─────────────────────────────────────────
    //  Totaux (footer)
    // ─────────────────────────────────────────

    get totalN1()      { return this.state.rows.reduce((s, r) => s + r.count_n1, 0); }
    get totalN()       { return this.state.rows.reduce((s, r) => s + r.count_n,  0); }
    get totalJoursN1() { return this.state.rows.reduce((s, r) => s + r.jours_n1, 0); }
    get totalJoursN()  { return this.state.rows.reduce((s, r) => s + r.jours_n,  0); }

    get totalDelta() {
        if (this.totalN1 === 0) return this.totalN > 0 ? 100 : null;
        return Math.round(((this.totalN - this.totalN1) / this.totalN1) * 100);
    }
    get totalDeltaJours() {
        if (this.totalJoursN1 === 0) return this.totalJoursN > 0 ? 100 : null;
        return Math.round(((this.totalJoursN - this.totalJoursN1) / this.totalJoursN1) * 100);
    }
}

ReservationDashboard.template = "dashboard_analytics.ReservationDashboard";

registry
    .category("actions")
    .add("dashboard_analytics.action_reservation_dashboard", ReservationDashboard);


// ═══════════════════════════════════════════════════════════════════════════
//  NOUVEAU COMPOSANT : ReservationDetailDashboard
//  Page détail : tableau croisé lieux × catégories + 2 graphiques barres
// ═══════════════════════════════════════════════════════════════════════════

export class ReservationDetailDashboard extends Component {

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        // Récupérer les paramètres passés par ouvrirMois
        const props = this.props;
        const params = props.action?.params || {};

        this.state = useState({
            loading    : true,
            label      : params.label  || "",
            domain     : params.domain || [],
            // Tableau croisé
            lieux      : [],       // [{id, name}]
            categories : [],       // [{id, name}]
            matrix     : {},       // matrix[lieu_id][cat_id] = {count, jours}
            // Totaux lignes / colonnes
            totaux_lieux : {},     // totaux_lieux[lieu_id] = {count, jours}
            totaux_cats  : {},     // totaux_cats[cat_id]   = {count, jours}
            grand_total  : { count: 0, jours: 0 },
        });

        onWillStart(() => this._loadData());
    }

    _pad(n) { return String(n).padStart(2, "0"); }

    async _loadData() {
        this.state.loading = true;
        try {
            const domain = this.state.domain;

            // Charger toutes les réservations avec les champs nécessaires
            const recs = await this.orm.searchRead(
                "reservation",
                domain,
                ["lieu_depart", "categorie", "nbr_jour_reservation"],
                { limit: 0 }
            );

            // Collecter les IDs uniques de lieux et catégories
            const lieuxMap  = {};
            const catsMap   = {};

            for (const r of recs) {
                if (r.lieu_depart && r.lieu_depart[0]) {
                    lieuxMap[r.lieu_depart[0]] = r.lieu_depart[1] || `Lieu ${r.lieu_depart[0]}`;
                }
                if (r.categorie && r.categorie[0]) {
                    catsMap[r.categorie[0]] = r.categorie[1] || `Cat. ${r.categorie[0]}`;
                }
            }

            // Trier par nom
            const lieux      = Object.entries(lieuxMap).map(([id, name]) => ({ id: parseInt(id), name }))
                                     .sort((a, b) => a.name.localeCompare(b.name));
            const categories = Object.entries(catsMap).map(([id, name]) => ({ id: parseInt(id), name }))
                                     .sort((a, b) => a.name.localeCompare(b.name));

            // Construire la matrice
            const matrix = {};
            for (const l of lieux) {
                matrix[l.id] = {};
                for (const c of categories) {
                    matrix[l.id][c.id] = { count: 0, jours: 0 };
                }
            }

            // Remplir la matrice
            for (const r of recs) {
                const lid = r.lieu_depart?.[0];
                const cid = r.categorie?.[0];
                if (lid && cid && matrix[lid] && matrix[lid][cid] !== undefined) {
                    matrix[lid][cid].count++;
                    matrix[lid][cid].jours += (r.nbr_jour_reservation || 0);
                }
            }

            // Totaux par ligne (lieu)
            const totaux_lieux = {};
            for (const l of lieux) {
                let count = 0, jours = 0;
                for (const c of categories) {
                    count += matrix[l.id][c.id].count;
                    jours += matrix[l.id][c.id].jours;
                }
                totaux_lieux[l.id] = { count, jours };
            }

            // Totaux par colonne (catégorie)
            const totaux_cats = {};
            for (const c of categories) {
                let count = 0, jours = 0;
                for (const l of lieux) {
                    count += matrix[l.id][c.id].count;
                    jours += matrix[l.id][c.id].jours;
                }
                totaux_cats[c.id] = { count, jours };
            }

            // Grand total
            const grand_total = {
                count : recs.length,
                jours : recs.reduce((s, r) => s + (r.nbr_jour_reservation || 0), 0),
            };

            this.state.lieux       = lieux;
            this.state.categories  = categories;
            this.state.matrix      = matrix;
            this.state.totaux_lieux = totaux_lieux;
            this.state.totaux_cats  = totaux_cats;
            this.state.grand_total  = grand_total;

        } finally {
            this.state.loading = false;
            setTimeout(() => {
                this._renderChartLieux();
                this._renderChartCategories();
            }, 50);
        }
    }

    retour() {
        this.action.doAction("dashboard_analytics.action_reservation_dashboard");
    }

    // ─── Graphique 1 : par lieu de départ ───────────────────────────────
    _renderChartLieux() {
        const canvas = document.getElementById("rdd-chart-lieux");
        if (!canvas) return;
        if (this._chartLieux) { this._chartLieux.destroy(); this._chartLieux = null; }

        const labels = this.state.lieux.map(l => l.name);
        const counts = this.state.lieux.map(l => this.state.totaux_lieux[l.id]?.count || 0);
        const jours  = this.state.lieux.map(l => this.state.totaux_lieux[l.id]?.jours || 0);

        const draw = () => {
            this._chartLieux = new Chart(canvas, {
                type : "bar",
                data : {
                    labels,
                    datasets: [
                        {
                            label           : "Réservations",
                            data            : counts,
                            backgroundColor : "rgba(21,101,192,0.8)",
                            borderRadius    : 6,
                            yAxisID         : "y",
                        },
                        {
                            label           : "Jours",
                            data            : jours,
                            backgroundColor : "rgba(106,27,154,0.8)",
                            borderRadius    : 6,
                            yAxisID         : "y1",
                        },
                    ],
                },
                options: {
                    responsive : true,
                    plugins    : {
                        legend : { position: "top", labels: { font: { weight: "bold" } } },
                        tooltip: {
                            callbacks: {
                                label: ctx => ` ${ctx.dataset.label} : ${ctx.parsed.y}`,
                            },
                        },
                    },
                    scales: {
                        x  : { grid: { display: false }, ticks: { font: { weight: "600" } } },
                        y  : { beginAtZero: true, position: "left",  title: { display: true, text: "Réservations" } },
                        y1 : { beginAtZero: true, position: "right", title: { display: true, text: "Jours" }, grid: { drawOnChartArea: false } },
                    },
                },
            });
        };

        if (window.Chart) { draw(); }
        else {
            const s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
            s.onload = draw;
            document.head.appendChild(s);
        }
    }

    // ─── Graphique 2 : par catégorie ────────────────────────────────────
    _renderChartCategories() {
        const canvas = document.getElementById("rdd-chart-categories");
        if (!canvas) return;
        if (this._chartCats) { this._chartCats.destroy(); this._chartCats = null; }

        const labels = this.state.categories.map(c => c.name);
        const counts = this.state.categories.map(c => this.state.totaux_cats[c.id]?.count || 0);
        const jours  = this.state.categories.map(c => this.state.totaux_cats[c.id]?.jours || 0);

        const draw = () => {
            this._chartCats = new Chart(canvas, {
                type : "bar",
                data : {
                    labels,
                    datasets: [
                        {
                            label           : "Réservations",
                            data            : counts,
                            backgroundColor : "rgba(22,163,74,0.8)",
                            borderRadius    : 6,
                            yAxisID         : "y",
                        },
                        {
                            label           : "Jours",
                            data            : jours,
                            backgroundColor : "rgba(220,38,38,0.8)",
                            borderRadius    : 6,
                            yAxisID         : "y1",
                        },
                    ],
                },
                options: {
                    responsive : true,
                    plugins    : {
                        legend : { position: "top", labels: { font: { weight: "bold" } } },
                        tooltip: {
                            callbacks: {
                                label: ctx => ` ${ctx.dataset.label} : ${ctx.parsed.y}`,
                            },
                        },
                    },
                    scales: {
                        x  : { grid: { display: false }, ticks: { font: { weight: "600" } } },
                        y  : { beginAtZero: true, position: "left",  title: { display: true, text: "Réservations" } },
                        y1 : { beginAtZero: true, position: "right", title: { display: true, text: "Jours" }, grid: { drawOnChartArea: false } },
                    },
                },
            });
        };

        if (window.Chart) { draw(); }
        else {
            const s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
            s.onload = draw;
            document.head.appendChild(s);
        }
    }

    // Helpers template
    getCell(lieu_id, cat_id) {
        return this.state.matrix[lieu_id]?.[cat_id] || { count: 0, jours: 0 };
    }
    getTotalLieu(lieu_id)  { return this.state.totaux_lieux[lieu_id] || { count: 0, jours: 0 }; }
    getTotalCat(cat_id)    { return this.state.totaux_cats[cat_id]   || { count: 0, jours: 0 }; }
}

ReservationDetailDashboard.template = "dashboard_analytics.ReservationDetailDashboard";

registry
    .category("actions")
    .add("dashboard_analytics.action_reservation_detail_dashboard", ReservationDetailDashboard);