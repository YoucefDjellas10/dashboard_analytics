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
            years         : years,
        });

        onWillStart(() => this._loadZones().then(() => this.loadData()));
    }

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
            this.state.loading = false;
            setTimeout(() => {
                this._renderChart();
                this._renderChartLine();
                this._renderChartRatio();
            }, 50);
        }
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

    retourDashboard() {
        this.action.doAction("dashboard_analytics.action_dashboard_statistiques");
    }

    onClickMois(ev) {
        const td    = ev.currentTarget;
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

    _renderChartRatio() {
        const canvas = document.getElementById("rd-chart-ratio");
        if (!canvas) return;

        if (this._chartRatio) {
            this._chartRatio.destroy();
            this._chartRatio = null;
        }

        const labels  = this.state.rows.map(r => r.label);
        const dataN1  = this.state.rows.map(r =>
            r.count_n1 > 0 ? Math.round((r.jours_n1 / r.count_n1) * 100) / 100 : 0
        );
        const dataN   = this.state.rows.map(r =>
            r.count_n > 0 ? Math.round((r.jours_n / r.count_n) * 100) / 100 : 0
        );

        const draw = () => {
            this._chartRatio = new Chart(canvas, {
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
                    responsive          : true,
                    maintainAspectRatio : true,
                    plugins: {
                        legend: {
                            position : "top",
                            labels   : { font: { weight: "bold" } },
                        },
                        tooltip: {
                            callbacks: {
                                label: ctx => ` ${ctx.dataset.label} : ${ctx.parsed.y} j/résv`,
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
                            ticks       : { font: { weight: "600" } },
                            title       : { display: true, text: "Jours / Réservation" },
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
//  COMPOSANT : ReservationDetailDashboard
// ═══════════════════════════════════════════════════════════════════════════

export class ReservationDetailDashboard extends Component {

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        const props  = this.props;
        const params = props.action?.params || {};

        this.state = useState({
            loading        : true,
            label          : params.label  || "",
            domain         : params.domain || [],
            zones          : [],
            lieux          : [],
            categories     : [],
            matrix_lieu    : {},
            matrix_zone    : {},
            totaux_lieux   : {},
            totaux_zones   : {},
            totaux_cats    : {},
            grand_total    : { count: 0, jours: 0 },
            expanded_zones : {},
            // Nouvelles données
            recs_raw       : [],   // toutes les réservations brutes conservées pour les nouveaux graphiques
        });

        onWillStart(() => this._loadData());
    }

    _pad(n) { return String(n).padStart(2, "0"); }

    async loadData() {
    this.state.loading = true;
    try {
        const n  = this.state.annee_n;
        const n1 = this.state.annee_n1;

        const MOIS_LABELS = [
            "Janvier","Février","Mars","Avril","Mai","Juin",
            "Juillet","Août","Septembre","Octobre","Novembre","Décembre"
        ];

        const _buildDomainYear = (annee, statusFilter) => {
            const debut = new Date(annee, 0,  1,  0,  0,  0);
            const fin   = new Date(annee, 11, 31, 23, 59, 59);
            const domain = [
                ["status",      "=",  statusFilter],
                ["create_date", ">=", this._formatORM(debut)],
                ["create_date", "<=", this._formatORM(fin)],
            ];
            if (this.state.selected_zone)
                domain.push(["zone", "=", parseInt(this.state.selected_zone)]);
            return domain;
        };

        const [recsN1, recsN, recsAnnuleN] = await Promise.all([
            this.orm.searchRead(
                "reservation",
                _buildDomainYear(n1, "confirmee"),
                ["create_date", "nbr_jour_reservation"],
                { limit: 0 }
            ),
            this.orm.searchRead(
                "reservation",
                _buildDomainYear(n, "confirmee"),
                ["create_date", "nbr_jour_reservation"],
                { limit: 0 }
            ),
            this.orm.searchRead(
                "reservation",
                _buildDomainYear(n, "annule"),
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

        const grpN1      = groupByMonth(recsN1);
        const grpN       = groupByMonth(recsN);
        const grpAnnuleN = groupByMonth(recsAnnuleN);

        const rows = [];
        for (let m = 1; m <= 12; m++) {
            const idx = m - 1;

            const count_n1 = grpN1.countArr[idx];
            const jours_n1 = grpN1.joursArr[idx];
            const count_n  = grpN.countArr[idx];
            const jours_n  = grpN.joursArr[idx];

            // Annulations année N
            const count_annule_n = grpAnnuleN.countArr[idx];
            const jours_annule_n = grpAnnuleN.joursArr[idx];

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
                count_annule_n, jours_annule_n,
                delta, delta_jours,
            });
        }

        this.state.rows = rows;

    } finally {
        this.state.loading = false;
        setTimeout(() => {
            this._renderChart();
            this._renderChartLine();
            this._renderChartRatio();
        }, 50);
    }
}
    get totalAnnuleN()       { return this.state.rows.reduce((s, r) => s + r.count_annule_n, 0); }
    get totalJoursAnnuleN()  { return this.state.rows.reduce((s, r) => s + r.jours_annule_n,  0); }
    toggleZone(zone_id) {
        this.state.expanded_zones[zone_id] = !this.state.expanded_zones[zone_id];
    }

    isZoneExpanded(zone_id) {
        return !!this.state.expanded_zones[zone_id];
    }

    getLieuxByZone(zone_id) {
        return this.state.lieux.filter(l => l.zone_id === zone_id);
    }

    retour() {
        this.action.doAction("dashboard_analytics.action_reservation_dashboard");
    }

    _renderChartZones() {
        const canvas = document.getElementById("rdd-chart-lieux");
        if (!canvas) return;
        if (this._chartLieux) { this._chartLieux.destroy(); this._chartLieux = null; }

        const labels = this.state.lieux.map(l => l.name);
        const counts = this.state.lieux.map(l => this.state.totaux_lieux[l.id]?.count || 0);

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
                        },
                    ],
                },
                options: {
                    responsive : true,
                    plugins    : {
                        legend : { position: "top", labels: { font: { weight: "bold" } } },
                        tooltip: {
                            callbacks: {
                                label: ctx => ` Réservations : ${ctx.parsed.y}`,
                            },
                        },
                    },
                    scales: {
                        x : { grid: { display: false }, ticks: { font: { weight: "600" } } },
                        y : {
                            beginAtZero : true,
                            title       : { display: true, text: "Réservations" },
                            ticks       : { stepSize: 1, font: { weight: "600" } },
                        },
                    },
                },
            });
        };

        if (window.Chart) { draw(); }
        else {
            const s = document.createElement("script");
            s.src    = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
            s.onload = draw;
            document.head.appendChild(s);
        }
    }

    _renderChartCategories() {
        const canvas = document.getElementById("rdd-chart-categories");
        if (!canvas) return;
        if (this._chartCats) { this._chartCats.destroy(); this._chartCats = null; }

        const labels = this.state.categories.map(c => c.name);
        const counts = this.state.categories.map(c => this.state.totaux_cats[c.id]?.count || 0);

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
                        },
                    ],
                },
                options: {
                    responsive : true,
                    plugins    : {
                        legend : { position: "top", labels: { font: { weight: "bold" } } },
                        tooltip: {
                            callbacks: {
                                label: ctx => ` Réservations : ${ctx.parsed.y}`,
                            },
                        },
                    },
                    scales: {
                        x : { grid: { display: false }, ticks: { font: { weight: "600" } } },
                        y : {
                            beginAtZero : true,
                            title       : { display: true, text: "Réservations" },
                            ticks       : { stepSize: 1, font: { weight: "600" } },
                        },
                    },
                },
            });
        };

        if (window.Chart) { draw(); }
        else {
            const s = document.createElement("script");
            s.src    = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
            s.onload = draw;
            document.head.appendChild(s);
        }
    }

    _renderChartLieuxMoy() {
        const canvas = document.getElementById("rdd-chart-lieux-moy");
        if (!canvas) return;
        if (this._chartLieuxMoy) { this._chartLieuxMoy.destroy(); this._chartLieuxMoy = null; }

        const labels = this.state.lieux.map(l => l.name);
        const data   = this.state.lieux.map(l => {
            const t = this.state.totaux_lieux[l.id] || { count: 0, jours: 0 };
            return t.count > 0 ? Math.round((t.jours / t.count) * 100) / 100 : 0;
        });

        const draw = () => {
            this._chartLieuxMoy = new Chart(canvas, {
                type : "bar",
                data : {
                    labels,
                    datasets: [{
                        label           : "Moyenne (j/résv)",
                        data,
                        backgroundColor : "rgba(21,101,192,0.8)",
                        borderRadius    : 6,
                    }],
                },
                options: {
                    responsive : true,
                    plugins: {
                        legend : { position: "top", labels: { font: { weight: "bold" } } },
                        tooltip: { callbacks: { label: ctx => ` Moyenne : ${ctx.parsed.y} j/résv` } },
                    },
                    scales: {
                        x : { grid: { display: false }, ticks: { font: { weight: "600" } } },
                        y : { beginAtZero: true, title: { display: true, text: "Jours / Réservation" }, ticks: { font: { weight: "600" } } },
                    },
                },
            });
        };
        if (window.Chart) { draw(); }
        else {
            const s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
            s.onload = draw; document.head.appendChild(s);
        }
    }

    _renderChartCategoriesMoy() {
        const canvas = document.getElementById("rdd-chart-categories-moy");
        if (!canvas) return;
        if (this._chartCatsMoy) { this._chartCatsMoy.destroy(); this._chartCatsMoy = null; }

        const labels = this.state.categories.map(c => c.name);
        const data   = this.state.categories.map(c => {
            const t = this.state.totaux_cats[c.id] || { count: 0, jours: 0 };
            return t.count > 0 ? Math.round((t.jours / t.count) * 100) / 100 : 0;
        });

        const draw = () => {
            this._chartCatsMoy = new Chart(canvas, {
                type : "bar",
                data : {
                    labels,
                    datasets: [{
                        label           : "Moyenne (j/résv)",
                        data,
                        backgroundColor : "rgba(22,163,74,0.8)",
                        borderRadius    : 6,
                    }],
                },
                options: {
                    responsive : true,
                    plugins: {
                        legend : { position: "top", labels: { font: { weight: "bold" } } },
                        tooltip: { callbacks: { label: ctx => ` Moyenne : ${ctx.parsed.y} j/résv` } },
                    },
                    scales: {
                        x : { grid: { display: false }, ticks: { font: { weight: "600" } } },
                        y : { beginAtZero: true, title: { display: true, text: "Jours / Réservation" }, ticks: { font: { weight: "600" } } },
                    },
                },
            });
        };
        if (window.Chart) { draw(); }
        else {
            const s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
            s.onload = draw; document.head.appendChild(s);
        }
    }

    // ── NOUVEAU 1 : Réservations par jour de la semaine ──────────────────────
    _renderChartJourSemaine() {
        const canvas = document.getElementById("rdd-chart-jour-semaine");
        if (!canvas) return;
        if (this._chartJourSemaine) { this._chartJourSemaine.destroy(); this._chartJourSemaine = null; }

        // Lundi=0 … Dimanche=6 (réindexation depuis getDay() où 0=Dimanche)
        const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
        const counts = new Array(7).fill(0);

        for (const r of this.state.recs_raw) {
            if (!r.create_date) continue;
            const d = new Date(r.create_date);
            // getDay() : 0=Dim, 1=Lun … 6=Sam → on remapped vers Lun=0
            const idx = (d.getDay() + 6) % 7;
            counts[idx]++;
        }

        const COLORS = [
            "rgba(21,101,192,0.8)","rgba(21,101,192,0.75)","rgba(21,101,192,0.7)",
            "rgba(21,101,192,0.65)","rgba(21,101,192,0.6)","rgba(106,27,154,0.75)","rgba(106,27,154,0.85)",
        ];

        const draw = () => {
            this._chartJourSemaine = new Chart(canvas, {
                type : "bar",
                data : {
                    labels   : JOURS,
                    datasets : [{
                        label           : "Réservations",
                        data            : counts,
                        backgroundColor : COLORS,
                        borderRadius    : 6,
                        borderSkipped   : false,
                    }],
                },
                options: {
                    responsive : true,
                    plugins: {
                        legend : { display: false },
                        tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} réservations` } },
                    },
                    scales: {
                        x : { grid: { display: false }, ticks: { font: { weight: "700" } } },
                        y : {
                            beginAtZero : true,
                            ticks       : { stepSize: 1, font: { weight: "600" } },
                            grid        : { color: "rgba(0,0,0,.06)" },
                        },
                    },
                },
            });
        };

        if (window.Chart) { draw(); }
        else {
            const s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
            s.onload = draw; document.head.appendChild(s);
        }
    }

    // ── NOUVEAU 2 : Heatmap semaine × jour ──────────────────────────────────
    _renderHeatmap() {
        const container = document.getElementById("rdd-heatmap-container");
        if (!container) return;

        // Construire la matrice : semaine (1-53) × jour (0=Lun…6=Dim)
        const matrix = {}; // matrix[weekNum][dayIdx] = count

        // Trouver la plage de semaines présentes dans les données
        let minWeek = Infinity, maxWeek = -Infinity;
        let minYear = Infinity;

        for (const r of this.state.recs_raw) {
            if (!r.create_date) continue;
            const d = new Date(r.create_date);
            const { week, year } = this._getISOWeek(d);
            const key = `${year}-${week}`;
            if (!matrix[key]) matrix[key] = new Array(7).fill(0);
            const dayIdx = (d.getDay() + 6) % 7;
            matrix[key][dayIdx]++;
            if (year < minYear || (year === minYear && week < minWeek)) {
                minWeek = week; minYear = year;
            }
            if (week > maxWeek) maxWeek = week;
        }

        // Trouver le max pour l'intensité
        let maxVal = 0;
        for (const key of Object.keys(matrix)) {
            for (const v of matrix[key]) {
                if (v > maxVal) maxVal = v;
            }
        }

        // Trier les clés semaine
        const weekKeys = Object.keys(matrix).sort();

        const JOURS_COURTS = ["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"];

        // Générer le HTML de la heatmap
        const cellSize  = 28;
        const cellGap   = 3;
        const labelW    = 28;
        const headerH   = 36;
        const nWeeks    = weekKeys.length;
        const svgW      = labelW + nWeeks * (cellSize + cellGap);
        const svgH      = headerH + 7 * (cellSize + cellGap);

        let cells = "";

        // En-têtes des semaines (afficher toutes les 4)
        weekKeys.forEach((key, wi) => {
            if (wi % 4 === 0) {
                const [yr, wk] = key.split("-");
                const x = labelW + wi * (cellSize + cellGap) + cellSize / 2;
                cells += `<text x="${x}" y="14" text-anchor="middle" font-size="9" fill="#94a3b8" font-weight="600">S${wk}</text>`;
            }
        });

        // Labels jours
        JOURS_COURTS.forEach((j, di) => {
            const y = headerH + di * (cellSize + cellGap) + cellSize / 2 + 4;
            cells += `<text x="${labelW - 4}" y="${y}" text-anchor="end" font-size="10" fill="#64748b" font-weight="700">${j}</text>`;
        });

        // Cellules
        weekKeys.forEach((key, wi) => {
            for (let di = 0; di < 7; di++) {
                const val  = matrix[key][di] || 0;
                const x    = labelW + wi * (cellSize + cellGap);
                const y    = headerH + di * (cellSize + cellGap);
                const intensity = maxVal > 0 ? val / maxVal : 0;
                const fill = val === 0
                    ? "#f1f5f9"
                    : this._heatColor(intensity);
                const textColor = intensity > 0.5 ? "#fff" : "#1e293b";
                cells += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="4" fill="${fill}">
                    <title>Semaine ${key} — ${JOURS_COURTS[di]} : ${val} résv</title>
                </rect>`;
                if (val > 0) {
                    cells += `<text x="${x + cellSize/2}" y="${y + cellSize/2 + 4}" text-anchor="middle" font-size="9" fill="${textColor}" font-weight="700">${val}</text>`;
                }
            }
        });

        container.innerHTML = `
            <div style="width:100%; overflow-x:auto; padding-bottom:8px;">
                <svg viewBox="0 0 ${svgW} ${svgH}" width="${Math.min(svgW, container.clientWidth || svgW)}" height="auto" preserveAspectRatio="xMidYMid meet" style="display:block; max-width:100%;">
                    ${cells}
                </svg>
            </div>
        `;
    }

    _heatColor(t) {
        // Dégradé : blanc → bleu clair → bleu foncé → violet
        if (t <= 0) return "#f1f5f9";
        if (t < 0.33) {
            const r = Math.round(186 + (21  - 186) * (t / 0.33));
            const g = Math.round(230 + (101 - 230) * (t / 0.33));
            const b = Math.round(253 + (192 - 253) * (t / 0.33));
            return `rgb(${r},${g},${b})`;
        }
        if (t < 0.66) {
            const tt = (t - 0.33) / 0.33;
            const r  = Math.round(21  + (30  - 21)  * tt);
            const g  = Math.round(101 + (58  - 101) * tt);
            const b  = Math.round(192 + (138 - 192) * tt);
            return `rgb(${r},${g},${b})`;
        }
        const tt = (t - 0.66) / 0.34;
        const r  = Math.round(30  + (106 - 30)  * tt);
        const g  = Math.round(58  + (27  - 58)  * tt);
        const b  = Math.round(138 + (154 - 138) * tt);
        return `rgb(${r},${g},${b})`;
    }

    _getISOWeek(d) {
        const date  = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const day   = date.getUTCDay() || 7;
        date.setUTCDate(date.getUTCDate() + 4 - day);
        const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
        const week  = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
        return { week, year: date.getUTCFullYear() };
    }

    // ── NOUVEAU 3 : Distribution des durées ─────────────────────────────────
    _renderChartDistributionDurees() {
        const canvas = document.getElementById("rdd-chart-distribution-durees");
        if (!canvas) return;
        if (this._chartDist) { this._chartDist.destroy(); this._chartDist = null; }

        // Tranches : 3-6, 7-13, 14-26, 27+
        const TRANCHES = [
            { label: "3 – 6 jours",  min: 3,  max: 6,        count: 0 },
            { label: "7 – 13 jours", min: 7,  max: 13,       count: 0 },
            { label: "14 – 26 jours",min: 14, max: 26,       count: 0 },
            { label: "27+ jours",    min: 27, max: Infinity,  count: 0 },
        ];

        for (const r of this.state.recs_raw) {
            const j = r.nbr_jour_reservation || 0;
            for (const t of TRANCHES) {
                if (j >= t.min && j <= t.max) { t.count++; break; }
            }
        }

        const COLORS = [
            "rgba(21,101,192,0.82)",
            "rgba(14,116,144,0.82)",
            "rgba(22,163,74,0.82)",
            "rgba(106,27,154,0.82)",
        ];

        const draw = () => {
            this._chartDist = new Chart(canvas, {
                type : "bar",
                data : {
                    labels   : TRANCHES.map(t => t.label),
                    datasets : [{
                        label           : "Réservations",
                        data            : TRANCHES.map(t => t.count),
                        backgroundColor : COLORS,
                        borderRadius    : 8,
                        borderSkipped   : false,
                    }],
                },
                options: {
                    responsive : true,
                    plugins: {
                        legend : { display: false },
                        tooltip: {
                            callbacks: {
                                label: ctx => ` ${ctx.parsed.y} réservations`,
                            },
                        },
                    },
                    scales: {
                        x : { grid: { display: false }, ticks: { font: { weight: "700" } } },
                        y : {
                            beginAtZero : true,
                            ticks       : { stepSize: 1, font: { weight: "600" } },
                            grid        : { color: "rgba(0,0,0,.06)" },
                            title       : { display: true, text: "Nombre de réservations" },
                        },
                    },
                },
            });
        };

        if (window.Chart) { draw(); }
        else {
            const s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
            s.onload = draw; document.head.appendChild(s);
        }
    }

    getCellLieu(lieu_id, cat_id)  { return this.state.matrix_lieu[lieu_id]?.[cat_id]  || { count: 0, jours: 0 }; }
    getCellZone(zone_id, cat_id)  { return this.state.matrix_zone[zone_id]?.[cat_id]  || { count: 0, jours: 0 }; }
    getTotalLieu(lieu_id)         { return this.state.totaux_lieux[lieu_id]  || { count: 0, jours: 0 }; }
    getTotalZone(zone_id)         { return this.state.totaux_zones[zone_id]  || { count: 0, jours: 0 }; }
    getTotalCat(cat_id)           { return this.state.totaux_cats[cat_id]    || { count: 0, jours: 0 }; }
}

ReservationDetailDashboard.template = "dashboard_analytics.ReservationDetailDashboard";

registry
    .category("actions")
    .add("dashboard_analytics.action_reservation_detail_dashboard", ReservationDetailDashboard);