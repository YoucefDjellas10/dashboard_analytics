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

    // ─── Utilitaires ──────────────────────────────────────────────────────────

    _pad(n) { return String(n).padStart(2, "0"); }

    _formatORM(d) {
        return `${d.getFullYear()}-${this._pad(d.getMonth()+1)}-${this._pad(d.getDate())} `
             + `${this._pad(d.getHours())}:${this._pad(d.getMinutes())}:${this._pad(d.getSeconds())}`;
    }

    _fmt(n) {
        return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    }

    async _loadZones() {
        this.state.zones = await this.orm.searchRead(
            "zone", [], ["id", "name"], { order: "name asc" }
        );
    }

    _getTaux(annee) {
        return annee < 2026 ? 260 : 270;
    }

    // ─── Fetch unifié par mois (identique à _get_revenues_by_date en Python) ──
    // Logique :
    //   - Si date_encaissement existe et est dans la période → on prend
    //   - Si date_encaissement est vide ET reservation.create_date dans la période → on prend
    // Pas de séparation is_old / pivot, exactement comme le Python.

    async _fetchMoisTresorerie(annee, mois) {
        const taux  = this._getTaux(annee);
        const debut = new Date(annee, mois - 1, 1,  0,  0,  0);
        const fin   = new Date(annee, mois,     0, 23, 59, 59);

        const zoneRevFilter = this.state.selected_zone
            ? [['zone_encaissement', '=', parseInt(this.state.selected_zone)]]
            : [];

        const zoneRefFilter = this.state.selected_zone
            ? [['reservation.zone', '=', parseInt(this.state.selected_zone)]]
            : [];

        // Cas 1 : date_encaissement existe et est dans la période
        const domainAvecDate = [
            ...zoneRevFilter,
            ['date_encaissement', '>=', this._formatORM(debut)],
            ['date_encaissement', '<=', this._formatORM(fin)],
        ];

        // Cas 2 : date_encaissement absente → on utilise reservation.create_date
        const domainSansDate = [
            ...zoneRevFilter,
            ['date_encaissement', '=', false],
            ['reservation.create_date', '>=', this._formatORM(debut)],
            ['reservation.create_date', '<=', this._formatORM(fin)],
        ];

        const refundDomain = [
            ['date', '>=', this._formatORM(debut)],
            ['date', '<=', this._formatORM(fin)],
            ['status', '=', 'effectuer'],
            ...zoneRefFilter,
        ];

        const [r1, r2, refund] = await Promise.all([
            this.orm.readGroup("revenue.record", domainAvecDate, ["montant_dzd:sum", "montant:sum"], []),
            this.orm.readGroup("revenue.record", domainSansDate, ["montant_dzd:sum", "montant:sum"], []),
            this.orm.readGroup("refund.table",   refundDomain,   ["amount:sum"], []),
        ]);

        const sum_dzd    = (r1[0]?.montant_dzd ?? 0) + (r2[0]?.montant_dzd ?? 0);
        const sum_eur    = (r1[0]?.montant     ?? 0) + (r2[0]?.montant     ?? 0);
        const sum_refund = (refund[0]?.amount  ?? 0);

        return (sum_dzd + (sum_eur * taux)) - (sum_refund * taux);
    }

    // ─── Trésorerie par zone (pie charts) ────────────────────────────────────
    // Même logique unifiée pour les pie charts

    async _fetchZoneTresorerie(annee, zoneId) {
        const taux  = this._getTaux(annee);
        const debut = new Date(annee, 0,  1,  0,  0,  0);
        const fin   = new Date(annee, 11, 31, 23, 59, 59);

        // Cas 1 : date_encaissement existe
        const domainAvecDate = [
            ['zone_encaissement', '=', zoneId],
            ['date_encaissement', '>=', this._formatORM(debut)],
            ['date_encaissement', '<=', this._formatORM(fin)],
        ];

        // Cas 2 : date_encaissement absente → reservation.create_date
        const domainSansDate = [
            ['zone_encaissement', '=', zoneId],
            ['date_encaissement', '=', false],
            ['reservation.create_date', '>=', this._formatORM(debut)],
            ['reservation.create_date', '<=', this._formatORM(fin)],
        ];

        const refundDomain = [
            ['date', '>=', this._formatORM(debut)],
            ['date', '<=', this._formatORM(fin)],
            ['status', '=', 'effectuer'],
            ['reservation.zone', '=', zoneId],
        ];

        const [r1, r2, refund] = await Promise.all([
            this.orm.readGroup("revenue.record", domainAvecDate, ["montant_dzd:sum", "montant:sum"], []),
            this.orm.readGroup("revenue.record", domainSansDate, ["montant_dzd:sum", "montant:sum"], []),
            this.orm.readGroup("refund.table",   refundDomain,   ["amount:sum"], []),
        ]);

        const sum_dzd    = (r1[0]?.montant_dzd ?? 0) + (r2[0]?.montant_dzd ?? 0);
        const sum_eur    = (r1[0]?.montant     ?? 0) + (r2[0]?.montant     ?? 0);
        const sum_refund = (refund[0]?.amount  ?? 0);

        return (sum_dzd + (sum_eur * taux)) - (sum_refund * taux);
    }

    // ─── Chargement principal ─────────────────────────────────────────────────

    async loadData() {
        this.state.loading = true;
        try {
            const n  = this.state.annee_n;
            const n1 = this.state.annee_n1;

            const MOIS_LABELS = [
                "Janvier","Février","Mars","Avril","Mai","Juin",
                "Juillet","Août","Septembre","Octobre","Novembre","Décembre"
            ];

            // Un seul appel par mois par année, logique unifiée
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

    async _loadPieData() {
        const zones   = await this.orm.searchRead("zone", [], ["id", "name"], { order: "name asc" });
        const results = await Promise.all(
            zones.map(z => this._fetchZoneTresorerie(this.state.annee_n, z.id))
        );
        this.state.pie_data = zones
            .map((z, i) => ({ zone_name: z.name, tresorerie: results[i] }))
            .filter(r => r.tresorerie > 0);
    }

    async _loadPieDataN1() {
        const zones   = await this.orm.searchRead("zone", [], ["id", "name"], { order: "name asc" });
        const results = await Promise.all(
            zones.map(z => this._fetchZoneTresorerie(this.state.annee_n1, z.id))
        );
        this.state.pie_data_n1 = zones
            .map((z, i) => ({ zone_name: z.name, tresorerie: results[i] }))
            .filter(r => r.tresorerie > 0);
    }

    // ─── Handlers UI ─────────────────────────────────────────────────────────

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
        const debut = new Date(annee, mois - 1, 1,  0,  0,  0);
        const fin   = new Date(annee, mois,     0, 23, 59, 59);
        const label = `${this.state.rows[mois-1]?.label} ${annee}`;

        // Même logique unifiée : date_encaissement OU reservation.create_date
        const revenueDomain = [
            '|',
            '&',
                ['date_encaissement', '>=', this._formatORM(debut)],
                ['date_encaissement', '<=', this._formatORM(fin)],
            '&',
                ['date_encaissement', '=', false],
                '&',
                    ['reservation.create_date', '>=', this._formatORM(debut)],
                    ['reservation.create_date', '<=', this._formatORM(fin)],
        ];

        if (this.state.selected_zone) {
            revenueDomain.push(['zone_encaissement', '=', parseInt(this.state.selected_zone)]);
        }

        this.action.doAction({
            type      : "ir.actions.act_window",
            name      : `Trésorerie — ${label}`,
            res_model : "revenue.record",
            view_mode : "list,form",
            domain    : revenueDomain,
        });
    }

    // ─── Charts ───────────────────────────────────────────────────────────────

    _renderChart() {
        const canvas = document.getElementById("tr-chart");
        if (!canvas) return;
        if (this._chart) { this._chart.destroy(); this._chart = null; }

        const labels = this.state.rows.map(r => r.label);
        const dataN1 = this.state.rows.map(r => Math.round(r.tr_n1));
        const dataN  = this.state.rows.map(r => Math.round(r.tr_n));

        const draw = () => {
            this._chart = new Chart(canvas, {
                type: "bar",
                data: {
                    labels,
                    datasets: [
                        { label: String(this.state.annee_n1), data: dataN1, backgroundColor: "rgba(21,101,192,0.75)", borderRadius: 6, borderSkipped: false },
                        { label: String(this.state.annee_n),  data: dataN,  backgroundColor: "rgba(106,27,154,0.75)", borderRadius: 6, borderSkipped: false },
                    ],
                },
                options: {
                    responsive: true, maintainAspectRatio: true,
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
        };

        if (window.Chart) { draw(); } else {
            const s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
            s.onload = draw;
            document.head.appendChild(s);
        }
    }

    _renderChartLine() {
        const canvas = document.getElementById("tr-chart-line");
        if (!canvas) return;
        if (this._chartLine) { this._chartLine.destroy(); this._chartLine = null; }

        const labels = this.state.rows.map(r => r.label);
        const dataN1 = this.state.rows.map(r => Math.round(r.tr_n1));
        const dataN  = this.state.rows.map(r => Math.round(r.tr_n));

        const draw = () => {
            this._chartLine = new Chart(canvas, {
                type: "line",
                data: {
                    labels,
                    datasets: [
                        { label: String(this.state.annee_n1), data: dataN1, borderColor: "rgba(21,101,192,1)", backgroundColor: "rgba(21,101,192,0.1)", borderWidth: 3, pointRadius: 5, pointHoverRadius: 7, fill: true, tension: 0.4 },
                        { label: String(this.state.annee_n),  data: dataN,  borderColor: "rgba(106,27,154,1)", backgroundColor: "rgba(106,27,154,0.1)", borderWidth: 3, pointRadius: 5, pointHoverRadius: 7, fill: true, tension: 0.4 },
                    ],
                },
                options: {
                    responsive: true, maintainAspectRatio: true,
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
        };

        if (window.Chart) { draw(); } else {
            const s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
            s.onload = draw;
            document.head.appendChild(s);
        }
    }

    _renderChartPie() {
        const canvas = document.getElementById("tr-chart-pie");
        if (!canvas) return;
        if (this._chartPie) { this._chartPie.destroy(); this._chartPie = null; }

        const labels = this.state.pie_data.map(r => r.zone_name);
        const data   = this.state.pie_data.map(r => Math.round(r.tresorerie));
        const COLORS = [
            "rgba(21,101,192,0.85)","rgba(106,27,154,0.85)","rgba(22,163,74,0.85)",
            "rgba(220,38,38,0.85)","rgba(234,179,8,0.85)","rgba(14,116,144,0.85)",
            "rgba(249,115,22,0.85)","rgba(99,102,241,0.85)",
        ];

        const draw = () => {
            this._chartPie = new Chart(canvas, {
                type: "pie",
                data: {
                    labels,
                    datasets: [{
                        data,
                        backgroundColor: COLORS.slice(0, labels.length),
                        borderWidth: 2,
                        borderColor: "#fff",
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
        };

        if (window.Chart) { draw(); } else {
            const s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
            s.onload = draw;
            document.head.appendChild(s);
        }
    }

    _renderChartPieN1() {
        const canvas = document.getElementById("tr-chart-pie-n1");
        if (!canvas) return;
        if (this._chartPieN1) { this._chartPieN1.destroy(); this._chartPieN1 = null; }

        const labels = this.state.pie_data_n1.map(r => r.zone_name);
        const data   = this.state.pie_data_n1.map(r => Math.round(r.tresorerie));
        const COLORS = [
            "rgba(21,101,192,0.85)","rgba(106,27,154,0.85)","rgba(22,163,74,0.85)",
            "rgba(220,38,38,0.85)","rgba(234,179,8,0.85)","rgba(14,116,144,0.85)",
            "rgba(249,115,22,0.85)","rgba(99,102,241,0.85)",
        ];

        const draw = () => {
            this._chartPieN1 = new Chart(canvas, {
                type: "pie",
                data: {
                    labels,
                    datasets: [{
                        data,
                        backgroundColor: COLORS.slice(0, labels.length),
                        borderWidth: 2,
                        borderColor: "#fff",
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
        };

        if (window.Chart) { draw(); } else {
            const s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
            s.onload = draw;
            document.head.appendChild(s);
        }
    }

    // ─── Totaux ───────────────────────────────────────────────────────────────

    get totalN1()    { return this.state.rows.reduce((s, r) => s + r.tr_n1, 0); }
    get totalN()     { return this.state.rows.reduce((s, r) => s + r.tr_n,  0); }
    get totalN1Fmt() { return this._fmt(this.totalN1); }
    get totalNFmt()  { return this._fmt(this.totalN); }

    get totalDelta() {
        if (this.totalN1 === 0) return this.totalN > 0 ? 100 : null;
        return Math.round(((this.totalN - this.totalN1) / this.totalN1) * 100);
    }

    fmtRow(val) { return this._fmt(val); }
}

TresorerieDashboard.template = "dashboard_analytics.TresorerieDashboard";

registry
    .category("actions")
    .add("dashboard_analytics.action_tresorerie_dashboard", TresorerieDashboard);