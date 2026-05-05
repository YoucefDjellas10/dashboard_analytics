/** @odoo-module **/

import { registry }   from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Component, onWillStart, useState } from "@odoo/owl";

export class ReservationDashboard extends Component {

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        this.state = useState({
            loading       : false,
            zones         : [],
            selected_zone : "",
            rows          : [], // [{ mois, label, count_n1, count_n }]
            annee_n       : new Date().getFullYear(),
            annee_n1      : new Date().getFullYear() - 1,
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

            // 24 requêtes en parallèle (12 mois x 2 années)
            const promises = [];
            for (let m = 1; m <= 12; m++) {
                promises.push(this.orm.readGroup("reservation", this._buildDomain(n1, m), ["id:count"], []));
                promises.push(this.orm.readGroup("reservation", this._buildDomain(n,  m), ["id:count"], []));
            }

            const results = await Promise.all(promises);

            const rows = [];
            for (let m = 1; m <= 12; m++) {
                const idx     = (m - 1) * 2;
                const count_n1 = results[idx][0]?.__count     ?? 0;
                const count_n  = results[idx+1][0]?.__count   ?? 0;

                // delta %
                let delta = null;
                if (count_n1 > 0) {
                    delta = Math.round(((count_n - count_n1) / count_n1) * 100);
                } else if (count_n > 0) {
                    delta = 100;
                }

                rows.push({
                    mois    : m,
                    label   : MOIS_LABELS[m - 1],
                    count_n1,
                    count_n,
                    delta,
                });
            }

            this.state.rows = rows;

        } finally {
            this.state.loading = false;
            // Render chart après mise à jour du DOM
            setTimeout(() => {
                this._renderChart();
                this._renderChartLine();
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

    retourDashboard() {
        this.action.doAction("dashboard_analytics.action_dashboard_statistiques");
    }

    ouvrirMois(annee, mois) {
        const debut = new Date(annee, mois - 1, 1,  0,  0,  0);
        const fin   = new Date(annee, mois,     0, 23, 59, 59);
        const fmt   = (d) => `${d.getFullYear()}-${this._pad(d.getMonth()+1)}-${this._pad(d.getDate())}`;
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

        // Détruire l'ancien chart s'il existe
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
                            label       : String(this.state.annee_n1),
                            data        : dataN1,
                            backgroundColor : "rgba(21, 101, 192, 0.75)",
                            borderRadius    : 6,
                            borderSkipped   : false,
                        },
                        {
                            label       : String(this.state.annee_n),
                            data        : dataN,
                            backgroundColor : "rgba(106, 27, 154, 0.75)",
                            borderRadius    : 6,
                            borderSkipped   : false,
                        },
                    ],
                },
                options: {
                    responsive    : true,
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

        // Si Chart.js déjà chargé
        // Si Chart.js déjà chargé
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

    get totalN1() { return this.state.rows.reduce((s, r) => s + r.count_n1, 0); }    get totalN()  { return this.state.rows.reduce((s, r) => s + r.count_n,  0); }
    get totalDelta() {
        if (this.totalN1 === 0) return this.totalN > 0 ? 100 : null;
        return Math.round(((this.totalN - this.totalN1) / this.totalN1) * 100);
    }
}

ReservationDashboard.template = "dashboard_analytics.ReservationDashboard";

registry
    .category("actions")
    .add("dashboard_analytics.action_reservation_dashboard", ReservationDashboard);