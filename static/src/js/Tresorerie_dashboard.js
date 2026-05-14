/** @odoo-module **/

import { registry }   from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Component, onWillStart, useState } from "@odoo/owl";

export class TresorerieDashboard extends Component {

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        const currentYear = new Date().getFullYear();
        const years = [];
        for (let y = currentYear; y >= currentYear - 5; y--) years.push(y);

        this.state = useState({
            loading      : false,
            zones        : [],
            selected_zone: "",
            rows         : [],
            annee_n      : currentYear,
            annee_n1     : currentYear - 1,
            pie_data     : [],
            pie_data_n1  : [],
            years        : years,
        });

        onWillStart(() => this._loadZones().then(() => this.loadData()));
    }

    // ─────────────────────────────────────────────
    // UTILITAIRES
    // ─────────────────────────────────────────────

    _fmt(n) {
        return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    }

    fmtRow(val) { return this._fmt(val); }

    // ─────────────────────────────────────────────
    // CHARGEMENT DES ZONES
    // ─────────────────────────────────────────────

    async _loadZones() {
        this.state.zones = await this.orm.searchRead(
            "zone", [], ["id", "name"], { order: "name asc" }
        );
    }

    // ─────────────────────────────────────────────
    // FETCH TRÉSORERIE — DÉLÉGATION AU PYTHON
    // ─────────────────────────────────────────────

    /**
     * Appelle get_tresorerie_mois() côté Python.
     * Python gère les deux périodes (is_old / date_encaissement / fallback reservation).
     * Retourne la trésorerie nette (float).
     */
    async _fetchMoisTresorerie(annee, mois) {
        const zoneId = this.state.selected_zone ? parseInt(this.state.selected_zone) : false;

        // ── Délègue à action_search_revenues (même résultat que la page Finance) ──
        const result = await this.orm.call(
            "dashboard.statistiques",
            "get_tresorerie_mois_v2",
            [annee, mois],
            { zone_id: zoneId }
        );

        return result.tresorerie ?? 0;
    }

    /**
     * Appelle get_tresorerie_par_zone_v2() côté Python pour les pie charts.
     */
    async _fetchZoneTresorerie(annee) {
        const result = await this.orm.call(
            "dashboard.statistiques",
            "get_tresorerie_par_zone_v2",
            [annee],
            {}
        );
        return result; // [{ zone_name, tresorerie }, ...]
    }

    // ─────────────────────────────────────────────
    // CHARGEMENT PRINCIPAL
    // ─────────────────────────────────────────────

    async loadData() {
        this.state.loading = true;
        try {
            const n  = this.state.annee_n;
            const n1 = this.state.annee_n1;

            const MOIS_LABELS = [
                "Janvier","Février","Mars","Avril","Mai","Juin",
                "Juillet","Août","Septembre","Octobre","Novembre","Décembre"
            ];

            // 24 appels en parallèle (12 mois × 2 années)
            const promises = [];
            for (let m = 1; m <= 12; m++) {
                promises.push(this._fetchMoisTresorerie(n1, m));
                promises.push(this._fetchMoisTresorerie(n,  m));
            }

            const results = await Promise.all(promises);

            const rows = [];
            for (let m = 1; m <= 12; m++) {
                const idx   = (m - 1) * 2;
                const tr_n1 = results[idx];
                const tr_n  = results[idx + 1];

                let delta = null;
                if (tr_n1 > 0) {
                    delta = Math.round(((tr_n - tr_n1) / tr_n1) * 100);
                } else if (tr_n > 0) {
                    delta = 100;
                }

                rows.push({ mois: m, label: MOIS_LABELS[m - 1], tr_n1, tr_n, delta });
            }

            this.state.rows = rows;

        } finally {
            // Pie charts en parallèle
            const [pieN, pieN1] = await Promise.all([
                this._fetchZoneTresorerie(this.state.annee_n),
                this._fetchZoneTresorerie(this.state.annee_n1),
            ]);
            this.state.pie_data    = pieN;
            this.state.pie_data_n1 = pieN1;

            this.state.loading = false;

            setTimeout(() => {
                this._renderChart();
                this._renderChartLine();
                this._renderChartPie();
                this._renderChartPieN1();
            }, 50);
        }
    }

    // ─────────────────────────────────────────────
    // HANDLERS UI
    // ─────────────────────────────────────────────

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

    ouvrirMois(annee, mois) {
        const label = `${this.state.rows[mois - 1]?.label} ${annee}`;

        // On passe le filtre au vue liste via le contexte :
        // la vue liste de revenue.record pourra filtrer selon la logique Python
        this.action.doAction({
            type      : "ir.actions.act_window",
            name      : `Trésorerie — ${label}`,
            res_model : "revenue.record",
            view_mode : "list,form",
            domain    : this._buildMoisDomain(annee, mois),
        });
    }

    /**
     * Construit un domain lisible pour la vue liste (affichage seulement).
     * On fait un 'ou' large : is_old + date_encaissement + create_date reservation.
     */
    _buildMoisDomain(annee, mois) {
        const debut = new Date(annee, mois - 1, 1,  0,  0,  0);
        const fin   = new Date(annee, mois,     0, 23, 59, 59);

        const fmt = (d) => {
            const pad = (n) => String(n).padStart(2, "0");
            return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} `
                 + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        };

        const debutStr = fmt(debut);
        const finStr   = fmt(fin);

        const domain = [
            '|',
            // Période ancienne (is_old)
            '&',
            ['is_old', '=', true],
            ['reservation.create_date', '>=', debutStr],
            // Période récente
            '|',
            // date_encaissement renseignée
            '&',
            ['date_encaissement', '>=', debutStr],
            ['date_encaissement', '<=', finStr],
            // fallback sur create_date réservation
            '&',
            ['date_encaissement', '=', false],
            ['reservation.create_date', '>=', debutStr],
        ];

        if (this.state.selected_zone) {
            domain.push(['zone_encaissement', '=', parseInt(this.state.selected_zone)]);
        }

        return domain;
    }

    // ─────────────────────────────────────────────
    // GETTERS TOTAUX
    // ─────────────────────────────────────────────

    get totalN1()    { return this.state.rows.reduce((s, r) => s + r.tr_n1, 0); }
    get totalN()     { return this.state.rows.reduce((s, r) => s + r.tr_n,  0); }
    get totalN1Fmt() { return this._fmt(this.totalN1); }
    get totalNFmt()  { return this._fmt(this.totalN); }

    get totalDelta() {
        if (this.totalN1 === 0) return this.totalN > 0 ? 100 : null;
        return Math.round(((this.totalN - this.totalN1) / this.totalN1) * 100);
    }

    // ─────────────────────────────────────────────
    // CHARTS
    // ─────────────────────────────────────────────

    _loadChartJs(callback) {
        if (window.Chart) {
            callback();
        } else {
            const s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
            s.onload = callback;
            document.head.appendChild(s);
        }
    }

    _renderChart() {
        const canvas = document.getElementById("tr-chart");
        if (!canvas) return;
        if (this._chart) { this._chart.destroy(); this._chart = null; }

        const labels = this.state.rows.map(r => r.label);
        const dataN1 = this.state.rows.map(r => Math.round(r.tr_n1));
        const dataN  = this.state.rows.map(r => Math.round(r.tr_n));

        this._loadChartJs(() => {
            this._chart = new Chart(canvas, {
                type: "bar",
                data: {
                    labels,
                    datasets: [
                        {
                            label          : String(this.state.annee_n1),
                            data           : dataN1,
                            backgroundColor: "rgba(21,101,192,0.75)",
                            borderRadius   : 6,
                            borderSkipped  : false,
                        },
                        {
                            label          : String(this.state.annee_n),
                            data           : dataN,
                            backgroundColor: "rgba(106,27,154,0.75)",
                            borderRadius   : 6,
                            borderSkipped  : false,
                        },
                    ],
                },
                options: {
                    responsive         : true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend  : { position: "top", labels: { font: { weight: "bold" } } },
                        tooltip : { callbacks: { label: ctx => ` ${ctx.dataset.label} : ${this._fmt(ctx.parsed.y)} DA` } },
                        datalabels: false,
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { font: { weight: "600" } } },
                        y: { beginAtZero: true, grid: { color: "rgba(0,0,0,.06)" }, ticks: { font: { weight: "600" } } },
                    },
                },
            });
        });
    }

    _renderChartLine() {
        const canvas = document.getElementById("tr-chart-line");
        if (!canvas) return;
        if (this._chartLine) { this._chartLine.destroy(); this._chartLine = null; }

        const labels = this.state.rows.map(r => r.label);
        const dataN1 = this.state.rows.map(r => Math.round(r.tr_n1));
        const dataN  = this.state.rows.map(r => Math.round(r.tr_n));

        this._loadChartJs(() => {
            this._chartLine = new Chart(canvas, {
                type: "line",
                data: {
                    labels,
                    datasets: [
                        {
                            label          : String(this.state.annee_n1),
                            data           : dataN1,
                            borderColor    : "rgba(21,101,192,1)",
                            backgroundColor: "rgba(21,101,192,0.1)",
                            borderWidth    : 3,
                            pointRadius    : 5,
                            pointHoverRadius: 7,
                            fill           : true,
                            tension        : 0.4,
                        },
                        {
                            label          : String(this.state.annee_n),
                            data           : dataN,
                            borderColor    : "rgba(106,27,154,1)",
                            backgroundColor: "rgba(106,27,154,0.1)",
                            borderWidth    : 3,
                            pointRadius    : 5,
                            pointHoverRadius: 7,
                            fill           : true,
                            tension        : 0.4,
                        },
                    ],
                },
                options: {
                    responsive         : true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend  : { position: "top", labels: { font: { weight: "bold" } } },
                        tooltip : { callbacks: { label: ctx => ` ${ctx.dataset.label} : ${this._fmt(ctx.parsed.y)} DA` } },
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { font: { weight: "600" } } },
                        y: { beginAtZero: true, grid: { color: "rgba(0,0,0,.06)" }, ticks: { font: { weight: "600" } } },
                    },
                },
            });
        });
    }

    _renderChartPie() {
        const canvas = document.getElementById("tr-chart-pie");
        if (!canvas) return;
        if (this._chartPie) { this._chartPie.destroy(); this._chartPie = null; }

        const labels = this.state.pie_data.map(r => r.zone_name);
        const data   = this.state.pie_data.map(r => Math.round(r.tresorerie));

        const COLORS = [
            "rgba(21,101,192,0.85)",
            "rgba(106,27,154,0.85)",
            "rgba(22,163,74,0.85)",
            "rgba(220,38,38,0.85)",
            "rgba(234,179,8,0.85)",
            "rgba(14,116,144,0.85)",
            "rgba(249,115,22,0.85)",
            "rgba(99,102,241,0.85)",
        ];

        this._loadChartJs(() => {
            this._chartPie = new Chart(canvas, {
                type: "pie",
                data: {
                    labels,
                    datasets: [{
                        data,
                        backgroundColor: COLORS.slice(0, labels.length),
                        borderWidth    : 2,
                        borderColor    : "#fff",
                    }],
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend : { position: "bottom", labels: { font: { weight: "600" }, padding: 16 } },
                        tooltip: { callbacks: { label: ctx => ` ${ctx.label} : ${this._fmt(ctx.parsed)} DA` } },
                    },
                },
            });
        });
    }

    _renderChartPieN1() {
        const canvas = document.getElementById("tr-chart-pie-n1");
        if (!canvas) return;
        if (this._chartPieN1) { this._chartPieN1.destroy(); this._chartPieN1 = null; }

        const labels = this.state.pie_data_n1.map(r => r.zone_name);
        const data   = this.state.pie_data_n1.map(r => Math.round(r.tresorerie));

        const COLORS = [
            "rgba(21,101,192,0.85)",
            "rgba(106,27,154,0.85)",
            "rgba(22,163,74,0.85)",
            "rgba(220,38,38,0.85)",
            "rgba(234,179,8,0.85)",
            "rgba(14,116,144,0.85)",
            "rgba(249,115,22,0.85)",
            "rgba(99,102,241,0.85)",
        ];

        this._loadChartJs(() => {
            this._chartPieN1 = new Chart(canvas, {
                type: "pie",
                data: {
                    labels,
                    datasets: [{
                        data,
                        backgroundColor: COLORS.slice(0, labels.length),
                        borderWidth    : 2,
                        borderColor    : "#fff",
                    }],
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend : { position: "bottom", labels: { font: { weight: "600" }, padding: 16 } },
                        tooltip: { callbacks: { label: ctx => ` ${ctx.label} : ${this._fmt(ctx.parsed)} DA` } },
                    },
                },
            });
        });
    }
}

TresorerieDashboard.template = "dashboard_analytics.TresorerieDashboard";

registry
    .category("actions")
    .add("dashboard_analytics.action_tresorerie_dashboard", TresorerieDashboard);