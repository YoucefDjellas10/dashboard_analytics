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

            // 2 requêtes searchRead globales (toute l'année) pour récupérer les jours
            // puis on regroupe côté JS par mois
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

            // Récupérer toutes les réservations des 2 années avec create_date + nbr_jour_reservation
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

            // Fonction utilitaire : grouper par mois
            const groupByMonth = (recs) => {
                const countArr = new Array(12).fill(0);
                const joursArr = new Array(12).fill(0);
                for (const r of recs) {
                    if (!r.create_date) continue;
                    const moisIdx = new Date(r.create_date).getMonth(); // 0-11
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

                // Évolution basée sur le nombre de réservations
                let delta = null;
                if (count_n1 > 0) {
                    delta = Math.round(((count_n - count_n1) / count_n1) * 100);
                } else if (count_n > 0) {
                    delta = 100;
                }

                // Évolution basée sur le nombre de jours
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

    ouvrirMois(annee, mois) {
        const debut = new Date(annee, mois - 1, 1,  0,  0,  0);
        const fin   = new Date(annee, mois,     0, 23, 59, 59);
        const label = `${this.state.rows[mois-1]?.label} ${annee}`;

        const domain = [
            ["status",      "=",  "confirmee"],
            ["create_date", ">=", this._formatORM(debut)],
            ["create_date", "<=", this._formatORM(fin)],
        ];
        if (this.state.selected_zone)
            domain.push(["zone", "=", parseInt(this.state.selected_zone)]);

        this.action.doAction({
            type      : "ir.actions.act_window",
            name      : `Réservations Confirmées — ${label}`,
            res_model : "reservation",
            view_mode : "list,form",
            domain,
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