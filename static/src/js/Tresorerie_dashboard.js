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

    // date pivot identique au Python : date_reference = datetime(2025, 11, 1)
    _DATE_PIVOT = new Date(2025, 10, 1, 0, 0, 0);

    _isAvantPivot(annee, mois) {
        // Équivalent Python : du < date_reference
        // du = premier jour du mois
        return new Date(annee, mois - 1, 1, 0, 0, 0) < this._DATE_PIVOT;
    }

    // ─── PÉRIODE AVANT 01/11/2025 ─────────────────────────────────────────────
    // Équivalent Python : domain.append(('is_old', '=', True))
    // Filtre date sur reservation.create_date (les anciens records n'ont pas date_encaissement)

    async _fetchMoisOld(annee, mois, zoneId) {
        const taux  = this._getTaux(annee);
        const debut = new Date(annee, mois - 1, 1,  0,  0,  0);
        const fin   = new Date(annee, mois,     0, 23, 59, 59);

        const zoneFilter = zoneId ? [['zone_encaissement', '=', zoneId]] : [];

        // is_old = True + filtre sur reservation.create_date (comme le Python)
        const domainRevenue = [
            ...zoneFilter,
            ['is_old', '=', true],
            ['reservation.create_date', '>=', this._formatORM(debut)],
            ['reservation.create_date', '<=', this._formatORM(fin)],
        ];

        const refundDomain = [
            ['date', '>=', this._formatORM(debut)],
            ['date', '<=', this._formatORM(fin)],
            ['status', '=', 'effectuer'],
        ];
        if (zoneId) {
            refundDomain.push(['reservation.zone', '=', zoneId]);
        }

        const [resRevenue, resRefund] = await Promise.all([
            this.orm.readGroup("revenue.record", domainRevenue, ["montant_dzd:sum", "montant:sum"], []),
            this.orm.readGroup("refund.table",   refundDomain,  ["amount:sum"], []),
        ]);

        const r        = resRevenue[0] ?? {};
        const sum_dzd  = r.montant_dzd ?? 0;
        const sum_eur  = r.montant     ?? 0;
        const sum_refund = (resRefund[0] ?? {}).amount ?? 0;

        return (sum_dzd + (sum_eur * taux)) - (sum_refund * taux);
    }

    // ─── PÉRIODE DEPUIS 01/11/2025 ────────────────────────────────────────────
    // Équivalent Python : domain.append('|') is_old=False OU is_old=None
    // Filtre date sur date_encaissement, fallback sur reservation.create_date si vide

    async _fetchMoisNew(annee, mois, zoneId) {
        const taux  = this._getTaux(annee);
        const debut = new Date(annee, mois - 1, 1,  0,  0,  0);
        const fin   = new Date(annee, mois,     0, 23, 59, 59);

        const zoneFilter = zoneId ? [['zone_encaissement', '=', zoneId]] : [];

        // is_old != True (False ou None) — équivalent Python :
        //   domain.append('|')
        //   domain.append(('is_old', '=', False))
        //   domain.append(('is_old', '=', None))
        const isNewFilter = ['|', ['is_old', '=', false], ['is_old', '=', false]];
        // Note : Odoo ORM : is_old != True s'écrit ['is_old', '!=', true]
        // ce qui couvre False ET null/None
        const isNewDomain = [['is_old', '!=', true]];

        // Recettes avec date_encaissement renseignée
        const domainAvecDate = [
            ...zoneFilter,
            ...isNewDomain,
            ['date_encaissement', '>=', this._formatORM(debut)],
            ['date_encaissement', '<=', this._formatORM(fin)],
        ];

        // Recettes sans date_encaissement → fallback reservation.create_date
        const domainSansDate = [
            ...zoneFilter,
            ...isNewDomain,
            ['date_encaissement', '=', false],
            ['reservation.create_date', '>=', this._formatORM(debut)],
            ['reservation.create_date', '<=', this._formatORM(fin)],
        ];

        const refundDomain = [
            ['date', '>=', this._formatORM(debut)],
            ['date', '<=', this._formatORM(fin)],
            ['status', '=', 'effectuer'],
        ];
        if (zoneId) {
            refundDomain.push(['reservation.zone', '=', zoneId]);
        }

        const [resAvecDate, resSansDate, resRefund] = await Promise.all([
            this.orm.readGroup("revenue.record", domainAvecDate, ["montant_dzd:sum", "montant:sum"], []),
            this.orm.readGroup("revenue.record", domainSansDate, ["montant_dzd:sum", "montant:sum"], []),
            this.orm.readGroup("refund.table",   refundDomain,   ["amount:sum"], []),
        ]);

        const r1 = resAvecDate[0] ?? {};
        const r2 = resSansDate[0] ?? {};

        const sum_dzd    = (r1.montant_dzd ?? 0) + (r2.montant_dzd ?? 0);
        const sum_eur    = (r1.montant     ?? 0) + (r2.montant     ?? 0);
        const sum_refund = (resRefund[0]   ?? {}).amount ?? 0;

        return (sum_dzd + (sum_eur * taux)) - (sum_refund * taux);
    }

    // ─── DISPATCHER ──────────────────────────────────────────────────────────
    // Aiguille vers Old ou New selon la date pivot — identique à action_search_revenues

    async _fetchMoisTresorerie(annee, mois) {
        const zoneId = this.state.selected_zone ? parseInt(this.state.selected_zone) : null;

        if (this._isAvantPivot(annee, mois)) {
            return this._fetchMoisOld(annee, mois, zoneId);
        } else {
            return this._fetchMoisNew(annee, mois, zoneId);
        }
    }

    // ─── Trésorerie annuelle par zone (pie charts) ───────────────────────────
    // Même logique pivot, sur toute l'année
    // Pour les années qui chevauchent le pivot (ex: 2025), on cumule Old + New

    async _fetchZoneTresorerie(annee, zoneId) {
        const taux    = this._getTaux(annee);
        const debutAn = new Date(annee, 0,  1,  0,  0,  0);
        const finAn   = new Date(annee, 11, 31, 23, 59, 59);

        let totalRevenue = 0;

        // --- Partie OLD : du début d'année jusqu'au pivot (ou fin d'année si année < 2025) ---
        if (debutAn < this._DATE_PIVOT) {
            const finOld = annee < 2025
                ? finAn
                : new Date(2025, 9, 31, 23, 59, 59); // 31/10/2025 = dernier jour avant pivot

            const domainOld = [
                ['zone_encaissement', '=', zoneId],
                ['is_old', '=', true],
                ['reservation.create_date', '>=', this._formatORM(debutAn)],
                ['reservation.create_date', '<=', this._formatORM(finOld)],
            ];

            const resOld = await this.orm.readGroup(
                "revenue.record", domainOld, ["montant_dzd:sum", "montant:sum"], []
            );
            const r = resOld[0] ?? {};
            totalRevenue += (r.montant_dzd ?? 0) + ((r.montant ?? 0) * taux);
        }

        // --- Partie NEW : depuis le pivot jusqu'à fin d'année ---
        if (finAn >= this._DATE_PIVOT) {
            const debutNew = debutAn >= this._DATE_PIVOT ? debutAn : this._DATE_PIVOT;

            const domainAvecDate = [
                ['zone_encaissement', '=', zoneId],
                ['is_old', '!=', true],
                ['date_encaissement', '>=', this._formatORM(debutNew)],
                ['date_encaissement', '<=', this._formatORM(finAn)],
            ];

            const domainSansDate = [
                ['zone_encaissement', '=', zoneId],
                ['is_old', '!=', true],
                ['date_encaissement', '=', false],
                ['reservation.create_date', '>=', this._formatORM(debutNew)],
                ['reservation.create_date', '<=', this._formatORM(finAn)],
            ];

            const [resNew1, resNew2] = await Promise.all([
                this.orm.readGroup("revenue.record", domainAvecDate, ["montant_dzd:sum", "montant:sum"], []),
                this.orm.readGroup("revenue.record", domainSansDate, ["montant_dzd:sum", "montant:sum"], []),
            ]);

            const n1 = resNew1[0] ?? {};
            const n2 = resNew2[0] ?? {};
            totalRevenue += (n1.montant_dzd ?? 0) + ((n1.montant ?? 0) * taux)
                          + (n2.montant_dzd ?? 0) + ((n2.montant ?? 0) * taux);
        }

        // --- Remboursements sur toute l'année ---
        const refundDomain = [
            ['date', '>=', this._formatORM(debutAn)],
            ['date', '<=', this._formatORM(finAn)],
            ['status', '=', 'effectuer'],
            ['reservation.zone', '=', zoneId],
        ];
        const resRefund  = await this.orm.readGroup(
            "refund.table", refundDomain, ["amount:sum"], []
        );
        const sum_refund = (resRefund[0] ?? {}).amount ?? 0;

        return totalRevenue - (sum_refund * taux);
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

            // 24 requêtes parallèles (12 mois × 2 années)
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

        let revenueDomain;

        if (this._isAvantPivot(annee, mois)) {
            // Avant pivot : is_old = True + reservation.create_date
            revenueDomain = [
                ['is_old', '=', true],
                ['reservation.create_date', '>=', this._formatORM(debut)],
                ['reservation.create_date', '<=', this._formatORM(fin)],
            ];
        } else {
            // Après pivot : is_old != True + date_encaissement ou fallback create_date
            revenueDomain = [
                ['is_old', '!=', true],
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
        }

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