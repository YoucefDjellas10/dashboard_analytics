/** @odoo-module **/

import { registry }   from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Component, onWillStart, useState } from "@odoo/owl";

export class TauxRemplissageDashboard extends Component {

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

    _nbJours(debut, fin) {
        return Math.round((fin - debut) / (1000 * 60 * 60 * 24));
    }

    async _fetchMoisTaux(annee, mois) {
        const debut = new Date(annee, mois - 1, 1,  0,  0,  0);
        const fin   = new Date(annee, mois,     0, 23, 59, 59);

        const domainRes = [
            ["status",           "=",  "confirmee"],
            ["date_heure_debut", "<=", this._formatORM(fin)],
            ["date_heure_fin",   ">=", this._formatORM(debut)],
        ];
        if (this.state.selected_zone)
            domainRes.push(["zone", "=", parseInt(this.state.selected_zone)]);

        const domainVeh = this.state.selected_zone
            ? [["zone", "=", parseInt(this.state.selected_zone)], ["active_test", "=", true]]
            : [["active_test", "=", true]];

        const [resList, vehList] = await Promise.all([
            this.orm.searchRead("reservation", domainRes, ["date_heure_debut", "date_heure_fin"]),
            this.orm.searchRead("vehicule", domainVeh, ["id"]),
        ]);

        const nbVehicules    = vehList.length;
        const nbJoursPeriode = this._nbJours(debut, fin);

        if (nbVehicules === 0 || nbJoursPeriode === 0) return 0;

        let totalJoursReserves = 0;
        for (const r of resList) {
            const deb = new Date(r.date_heure_debut);
            const fn  = new Date(r.date_heure_fin);
            const startIntersect = deb < debut ? debut : deb;
            const endIntersect   = fn  > fin   ? fin   : fn;
            const jours = Math.ceil((endIntersect - startIntersect) / (1000 * 60 * 60 * 24));
            if (jours > 0) totalJoursReserves += jours;
        }

        const taux = (totalJoursReserves / (nbVehicules * nbJoursPeriode)) * 100;
        return Math.min(100, Math.round(taux));
    }

    async _fetchZoneTaux(annee, zoneId) {
        const debut = new Date(annee, 0,  1,  0,  0,  0);
        const fin   = new Date(annee, 11, 31, 23, 59, 59);

        const domainRes = [
            ["status",           "=",  "confirmee"],
            ["date_heure_debut", "<=", this._formatORM(fin)],
            ["date_heure_fin",   ">=", this._formatORM(debut)],
            ["zone",             "=",  zoneId],
        ];

        const domainVeh = [
            ["zone",        "=",  zoneId],
            ["active_test", "=",  true],
        ];

        const [resList, vehList] = await Promise.all([
            this.orm.searchRead("reservation", domainRes, ["date_heure_debut", "date_heure_fin"]),
            this.orm.searchRead("vehicule", domainVeh, ["id"]),
        ]);

        const nbVehicules    = vehList.length;
        const nbJoursPeriode = this._nbJours(debut, fin);

        if (nbVehicules === 0 || nbJoursPeriode === 0) return 0;

        let totalJoursReserves = 0;
        for (const r of resList) {
            const deb = new Date(r.date_heure_debut);
            const fn  = new Date(r.date_heure_fin);
            const startIntersect = deb < debut ? debut : deb;
            const endIntersect   = fn  > fin   ? fin   : fn;
            const jours = Math.ceil((endIntersect - startIntersect) / (1000 * 60 * 60 * 24));
            if (jours > 0) totalJoursReserves += jours;
        }

        const taux = (totalJoursReserves / (nbVehicules * nbJoursPeriode)) * 100;
        return Math.min(100, Math.round(taux));
    }

    async loadData() {
        this.state.loading = true;
        try {
            const n = this.state.annee_n;

            const MOIS_LABELS = [
                "Janvier","Février","Mars","Avril","Mai","Juin",
                "Juillet","Août","Septembre","Octobre","Novembre","Décembre"
            ];

            const promises = [];
            for (let m = 1; m <= 12; m++) {
                promises.push(this._fetchMoisTaux(n, m));
            }

            const results = await Promise.all(promises);

            this.state.rows = results.map((taux, i) => ({
                mois  : i + 1,
                label : MOIS_LABELS[i],
                taux,
            }));

        } finally {
            await this._loadPieData();
            this.state.loading = false;
            setTimeout(() => {
                this._renderChart();
                this._renderChartPie();
            }, 50);
        }
    }

    async _loadPieData() {
        const zones   = await this.orm.searchRead("zone", [], ["id", "name"], { order: "name asc" });
        const results = await Promise.all(zones.map(z => this._fetchZoneTaux(this.state.annee_n, z.id)));
        this.state.pie_data = zones.map((z, i) => ({ zone_name: z.name, taux: results[i] })).filter(r => r.taux > 0);
    }

    updateSelectedZone(ev) {
        this.state.selected_zone = ev.target.value;
        this.loadData();
    }

    updateSelectedYear(ev) {
        this.state.annee_n = parseInt(ev.target.value);
        this.loadData();
    }

    retourDashboard() {
        this.action.doAction("dashboard_analytics.action_dashboard_statistiques");
    }

    ouvrirMois(mois) {
        const annee = this.state.annee_n;
        const debut = new Date(annee, mois - 1, 1,  0,  0,  0);
        const fin   = new Date(annee, mois,     0, 23, 59, 59);
        const label = `${this.state.rows[mois-1]?.label} ${annee}`;

        const domain = [
            ["status",           "=",  "confirmee"],
            ["date_heure_debut", "<=", this._formatORM(fin)],
            ["date_heure_fin",   ">=", this._formatORM(debut)],
        ];
        if (this.state.selected_zone)
            domain.push(["zone", "=", parseInt(this.state.selected_zone)]);

        this.action.doAction({
            type      : "ir.actions.act_window",
            name      : `Réservations — ${label}`,
            res_model : "reservation",
            view_mode : "list,form",
            domain,
        });
    }

    _renderChart() {
        const canvas = document.getElementById("tr-remplissage-chart");
        if (!canvas) return;
        if (this._chart) { this._chart.destroy(); this._chart = null; }

        const labels = this.state.rows.map(r => r.label);
        const data   = this.state.rows.map(r => r.taux);

        const draw = () => {
            this._chart = new Chart(canvas, {
                type: "bar",
                data: {
                    labels,
                    datasets: [{
                        label           : `Taux de remplissage ${this.state.annee_n} (%)`,
                        data,
                        backgroundColor : data.map(v =>
                            v >= 75 ? "rgba(22,163,74,0.8)" :
                            v >= 40 ? "rgba(234,179,8,0.8)" :
                                      "rgba(220,38,38,0.8)"
                        ),
                        borderRadius    : 6,
                        borderSkipped   : false,
                    }],
                },
                options: {
                    responsive: true, maintainAspectRatio: true,
                    plugins: {
                        legend  : { position: "top", labels: { font: { weight: "bold" } } },
                        tooltip : { callbacks: { label: ctx => ` ${ctx.parsed.y} %` } },
                        datalabels: false,
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { font: { weight: "600" } } },
                        y: { beginAtZero: true, max: 100, grid: { color: "rgba(0,0,0,.06)" }, ticks: { font: { weight: "600" }, callback: v => `${v} %` } },
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
        const canvas = document.getElementById("tr-remplissage-pie");
        if (!canvas) return;
        if (this._chartPie) { this._chartPie.destroy(); this._chartPie = null; }

        const labels = this.state.pie_data.map(r => r.zone_name);
        const data   = this.state.pie_data.map(r => r.taux);
        const COLORS = ["rgba(22,163,74,0.85)","rgba(14,116,144,0.85)","rgba(21,101,192,0.85)","rgba(106,27,154,0.85)","rgba(234,179,8,0.85)","rgba(249,115,22,0.85)","rgba(99,102,241,0.85)","rgba(107,15,58,0.85)"];

        const draw = () => {
            this._chartPie = new Chart(canvas, {
                type: "pie",
                data: { labels, datasets: [{ data, backgroundColor: COLORS.slice(0, labels.length), borderWidth: 2, borderColor: "#fff" }] },
                options: {
                    responsive: true,
                    plugins: {
                        legend  : { position: "bottom", labels: { font: { weight: "600" }, padding: 16 } },
                        tooltip : { callbacks: { label: ctx => ` ${ctx.label} : ${ctx.parsed} %` } },
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

    get moyenneTaux() {
        const rows = this.state.rows.filter(r => r.taux > 0);
        if (rows.length === 0) return 0;
        return Math.round(rows.reduce((s, r) => s + r.taux, 0) / rows.length);
    }

    tauxColor(val) {
        if (val >= 75) return "#16a34a";
        if (val >= 40) return "#ca8a04";
        return "#dc2626";
    }
}

TauxRemplissageDashboard.template = "dashboard_analytics.TauxRemplissageDashboard";

registry
    .category("actions")
    .add("dashboard_analytics.action_taux_remplissage_dashboard", TauxRemplissageDashboard);