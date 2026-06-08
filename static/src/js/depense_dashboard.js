/** @odoo-module **/

import { registry }   from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Component, onWillStart, useState } from "@odoo/owl";

export class DepenseDashboard extends Component {

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        const currentYear = new Date().getFullYear();
        const years = [];
        for (let y = currentYear; y >= currentYear - 5; y--) years.push(y);

        this.state = useState({
            loading           : false,
            zones             : [],
            selected_zone     : "",
            types_depense     : [],
            selected_type     : "",
            rows              : [],
            annee_n           : currentYear,
            annee_n1          : currentYear - 1,
            years             : years,
            modal             : null,
        });

        // Bind explicite pour garantir le contexte dans les handlers OWL
        this.ouvrirMois   = this.ouvrirMois.bind(this);
        this.fermerModal  = this.fermerModal.bind(this);

        onWillStart(() =>
            Promise.all([this._loadZones(), this._loadTypesDepense()])
                   .then(() => this.loadData())
        );
    }

    _pad(n) { return String(n).padStart(2, "0"); }

    _formatORM(d) {
        return `${d.getFullYear()}-${this._pad(d.getMonth()+1)}-${this._pad(d.getDate())} `
             + `${this._pad(d.getHours())}:${this._pad(d.getMinutes())}:${this._pad(d.getSeconds())}`;
    }

    _toDateStr(d) {
        return `${d.getFullYear()}-${this._pad(d.getMonth()+1)}-${this._pad(d.getDate())}`;
    }

    async _loadZones() {
        this.state.zones = await this.orm.searchRead(
            "zone", [], ["id", "name"], { order: "name asc" }
        );
    }

    async _loadTypesDepense() {
        this.state.types_depense = await this.orm.searchRead(
            "type.depens", [], ["id", "name"], { order: "name asc" }
        );
    }

    _fmt(n) {
        return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    }

    async _fetchMoisDepense(annee, mois) {
        const debut = new Date(annee, mois - 1, 1,  0,  0,  0);
        const fin   = new Date(annee, mois,     0, 23, 59, 59);

        const domain = [
            ["status",              "=",  "valide"],
            ["date_de_realisation", ">=", this._toDateStr(debut)],
            ["date_de_realisation", "<=", this._toDateStr(fin)],
        ];
        if (this.state.selected_zone)
            domain.push(["zone", "=", parseInt(this.state.selected_zone)]);
        if (this.state.selected_type)
            domain.push(["type_depense", "=", parseInt(this.state.selected_type)]);

        const result = await this.orm.readGroup("depense.record", domain, ["montant_da:sum"], []);
        return (result[0] ?? {}).montant_da ?? 0;
    }

    async _fetchZoneDepense(annee, zoneId) {
        const debut = new Date(annee, 0,  1,  0,  0,  0);
        const fin   = new Date(annee, 11, 31, 23, 59, 59);

        const domain = [
            ["status",              "=",  "valide"],
            ["date_de_realisation", ">=", this._toDateStr(debut)],
            ["date_de_realisation", "<=", this._toDateStr(fin)],
            ["zone",                "=",  zoneId],
        ];

        const result = await this.orm.readGroup("depense.record", domain, ["montant_da:sum"], []);
        return (result[0] ?? {}).montant_da ?? 0;
    }

    async loadData() {
        this.state.loading = true;
        try {
            const n  = this.state.annee_n;
            const n1 = this.state.annee_n1;

            const MOIS_LABELS = [
                "Janvier","Février","Mars","Avril","Mai","Juin",
                "Juillet","Août","Septembre","Octobre","Novembre","Décembre"
            ];

            const promises = [];
            for (let m = 1; m <= 12; m++) {
                promises.push(this._fetchMoisDepense(n1, m));
                promises.push(this._fetchMoisDepense(n,  m));
            }

            const results = await Promise.all(promises);

            const rows = [];
            for (let m = 1; m <= 12; m++) {
                const idx    = (m - 1) * 2;
                const dep_n1 = results[idx];
                const dep_n  = results[idx + 1];

                let delta = null;
                if (dep_n1 > 0) {
                    delta = Math.round(((dep_n - dep_n1) / dep_n1) * 100);
                } else if (dep_n > 0) {
                    delta = 100;
                }

                rows.push({ mois: m, label: MOIS_LABELS[m - 1], dep_n1, dep_n, delta });
            }

            this.state.rows = rows;

        } finally {
            this.state.loading = false;
            setTimeout(() => {
                this._renderChart();
                this._renderChartLine();

            }, 50);
        }
    }

    async _loadPieData() {
        const zones   = await this.orm.searchRead("zone", [], ["id", "name"], { order: "name asc" });
        const results = await Promise.all(zones.map(z => this._fetchZoneDepense(this.state.annee_n, z.id)));
        this.state.pie_data = zones.map((z, i) => ({ zone_name: z.name, depense: results[i] })).filter(r => r.depense > 0);
    }

    async _loadPieDataN1() {
        const zones   = await this.orm.searchRead("zone", [], ["id", "name"], { order: "name asc" });
        const results = await Promise.all(zones.map(z => this._fetchZoneDepense(this.state.annee_n1, z.id)));
        this.state.pie_data_n1 = zones.map((z, i) => ({ zone_name: z.name, depense: results[i] })).filter(r => r.depense > 0);
    }

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

    updateSelectedType(ev) {
        this.state.selected_type = ev.target.value;
        this.loadData();
    }

    retourDashboard() {
        this.action.doAction("dashboard_analytics.action_dashboard_statistiques");
    }

async ouvrirMois(annee, mois) {
    const state = this.state;
    const orm   = this.orm;

    const debut   = new Date(annee, mois - 1, 1,  0,  0,  0);
    const fin     = new Date(annee, mois,     0, 23, 59, 59);

    // Mois précédent (même mois, année N-1 ou N selon ce qui est affiché)
    const datePrev  = new Date(annee, mois - 2, 1);
    const anneePrev = datePrev.getFullYear();
    const moisPrev  = datePrev.getMonth() + 1;
    const debutPrev = new Date(anneePrev, moisPrev - 1, 1,  0,  0,  0);
    const finPrev   = new Date(anneePrev, moisPrev,     0, 23, 59, 59);

    const label = `${state.rows[mois - 1]?.label} ${annee}`;

    const buildDomain = (d, f) => {
        const domain = [
            ["status",              "=",  "valide"],
            ["date_de_realisation", ">=", this._toDateStr(d)],
            ["date_de_realisation", "<=", this._toDateStr(f)],
        ];
        if (state.selected_zone)
            domain.push(["zone", "=", parseInt(state.selected_zone)]);
        if (state.selected_type)
            domain.push(["type_depense", "=", parseInt(state.selected_type)]);
        return domain;
    };

    const [groupsCurrent, groupsPrev] = await Promise.all([
        orm.readGroup("depense.record", buildDomain(debut, fin),     ["montant_da:sum"], ["type_depense"], { orderby: "montant_da desc" }),
        orm.readGroup("depense.record", buildDomain(debutPrev, finPrev), ["montant_da:sum"], ["type_depense"], {}),
    ]);

    // Map N-1 par type_depense id pour lookup rapide
    const mapPrev = {};
    for (const g of groupsPrev) {
        const key = g.type_depense ? g.type_depense[0] : 0;
        mapPrev[key] = g.montant_da ?? 0;
    }

    const lignes = groupsCurrent.map(g => {
        const key      = g.type_depense ? g.type_depense[0] : 0;
        const montant  = g.montant_da ?? 0;
        const montantP = mapPrev[key] ?? 0;

        let delta = null;
        if (montantP > 0)       delta = Math.round(((montant - montantP) / montantP) * 100);
        else if (montant > 0)   delta = 100;

        return {
            type    : g.type_depense ? g.type_depense[1] : "— Sans type —",
            montant,
            delta,
        };
    });

    const MOIS_LABELS = [
    "Janvier","Février","Mars","Avril","Mai","Juin",
    "Juillet","Août","Septembre","Octobre","Novembre","Décembre"
];

state.modal = {
    titre    : label,
    titrePrev: `${MOIS_LABELS[moisPrev - 1]} ${anneePrev}`,
    lignes
};
}
    fermerModal() {
        this.state.modal = null;
    }

    _renderChart() {
        const canvas = document.getElementById("dep-chart");
        if (!canvas) return;
        if (this._chart) { this._chart.destroy(); this._chart = null; }

        const labels = this.state.rows.map(r => r.label);
        const dataN1 = this.state.rows.map(r => Math.round(r.dep_n1));
        const dataN  = this.state.rows.map(r => Math.round(r.dep_n));

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
        const canvas = document.getElementById("dep-chart-line");
        if (!canvas) return;
        if (this._chartLine) { this._chartLine.destroy(); this._chartLine = null; }

        const labels = this.state.rows.map(r => r.label);
        const dataN1 = this.state.rows.map(r => Math.round(r.dep_n1));
        const dataN  = this.state.rows.map(r => Math.round(r.dep_n));

        const draw = () => {
            this._chartLine = new Chart(canvas, {
                type: "line",
                data: {
                    labels,
                    datasets: [
                        { label: String(this.state.annee_n1), data: dataN1, borderColor: "rgba(21,101,192,1)",  backgroundColor: "rgba(21,101,192,0.1)",  borderWidth: 3, pointRadius: 5, pointHoverRadius: 7, fill: true, tension: 0.4 },
                        { label: String(this.state.annee_n),  data: dataN,  borderColor: "rgba(106,27,154,1)",  backgroundColor: "rgba(106,27,154,0.1)",  borderWidth: 3, pointRadius: 5, pointHoverRadius: 7, fill: true, tension: 0.4 },
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
        const canvas = document.getElementById("dep-chart-pie");
        if (!canvas) return;
        if (this._chartPie) { this._chartPie.destroy(); this._chartPie = null; }

        const labels = this.state.pie_data.map(r => r.zone_name);
        const data   = this.state.pie_data.map(r => Math.round(r.depense));
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

        const draw = () => {
            this._chartPie = new Chart(canvas, {
                type: "pie",
                data: { labels, datasets: [{ data, backgroundColor: COLORS.slice(0, labels.length), borderWidth: 2, borderColor: "#fff" }] },
                options: { responsive: true, plugins: { legend: { position: "bottom", labels: { font: { weight: "600" }, padding: 16 } }, tooltip: { callbacks: { label: ctx => ` ${ctx.label} : ${this._fmt(ctx.parsed)} DA` } } } },
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
        const canvas = document.getElementById("dep-chart-pie-n1");
        if (!canvas) return;
        if (this._chartPieN1) { this._chartPieN1.destroy(); this._chartPieN1 = null; }

        const labels = this.state.pie_data_n1.map(r => r.zone_name);
        const data   = this.state.pie_data_n1.map(r => Math.round(r.depense));
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

        const draw = () => {
            this._chartPieN1 = new Chart(canvas, {
                type: "pie",
                data: { labels, datasets: [{ data, backgroundColor: COLORS.slice(0, labels.length), borderWidth: 2, borderColor: "#fff" }] },
                options: { responsive: true, plugins: { legend: { position: "bottom", labels: { font: { weight: "600" }, padding: 16 } }, tooltip: { callbacks: { label: ctx => ` ${ctx.label} : ${this._fmt(ctx.parsed)} DA` } } } },
            });
        };

        if (window.Chart) { draw(); } else {
            const s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
            s.onload = draw;
            document.head.appendChild(s);
        }
    }

    get totalN1()    { return this.state.rows.reduce((s, r) => s + r.dep_n1, 0); }
    get totalN()     { return this.state.rows.reduce((s, r) => s + r.dep_n,  0); }
    get totalN1Fmt() { return this._fmt(this.totalN1); }
    get totalNFmt()  { return this._fmt(this.totalN); }

    get totalDelta() {
        if (this.totalN1 === 0) return this.totalN > 0 ? 100 : null;
        return Math.round(((this.totalN - this.totalN1) / this.totalN1) * 100);
    }

    fmtRow(val) { return this._fmt(val); }
}

DepenseDashboard.template = "dashboard_analytics.DepenseDashboard";

registry
    .category("actions")
    .add("dashboard_analytics.action_depense_dashboard", DepenseDashboard);