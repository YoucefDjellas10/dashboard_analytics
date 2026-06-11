/** @odoo-module **/

import { registry }   from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Component, onWillStart, useState } from "@odoo/owl";

// ═══════════════════════════════════════════════════════════════════════════
//  COMPOSANT PRINCIPAL — TauxRemplissageDashboard
// ═══════════════════════════════════════════════════════════════════════════

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
            this.state.loading = false;
            setTimeout(() => {
                this._renderChart();
            }, 50);
        }
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

    // ── Clic sur une ligne du tableau → ouvre le détail par zone ──
    onClickMois(ev) {
        const tr   = ev.currentTarget;
        const mois = parseInt(tr.dataset.mois);
        const label = this.state.rows[mois - 1]?.label + " " + this.state.annee_n;

        this.action.doAction({
            type   : "ir.actions.client",
            tag    : "dashboard_analytics.action_taux_remplissage_detail_dashboard",
            name   : `Taux de remplissage — ${label}`,
            target : "current",
            params : {
                annee         : this.state.annee_n,
                mois,
                label,
                selected_zone : this.state.selected_zone,
            },
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


// ═══════════════════════════════════════════════════════════════════════════
//  COMPOSANT DÉTAIL — TauxRemplissageDetailDashboard
//  Affiche le taux par zone pour un mois donné
// ═══════════════════════════════════════════════════════════════════════════

export class TauxRemplissageDetailDashboard extends Component {

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        const params = this.props.action?.params || {};

        this.state = useState({
            loading       : true,
            annee         : params.annee         || new Date().getFullYear(),
            mois          : params.mois          || 1,
            label         : params.label         || "",
            selected_zone : params.selected_zone || "",
            rows          : [],   // { zone_id, zone_name, taux, nbVehicules, joursReserves, nbJoursPeriode }
        });

        onWillStart(() => this._loadDetailData());
    }

    _pad(n) { return String(n).padStart(2, "0"); }

    _formatORM(d) {
        return `${d.getFullYear()}-${this._pad(d.getMonth()+1)}-${this._pad(d.getDate())} `
             + `${this._pad(d.getHours())}:${this._pad(d.getMinutes())}:${this._pad(d.getSeconds())}`;
    }

    async _loadDetailData() {
        this.state.loading = true;
        try {
            const { annee, mois, selected_zone } = this.state;

            const debut = new Date(annee, mois - 1, 1,  0,  0,  0);
            const fin   = new Date(annee, mois,     0, 23, 59, 59);
            const nbJoursPeriode = Math.round((fin - debut) / (1000 * 60 * 60 * 24));

            // Charger toutes les zones (ou seulement la zone filtrée)
            let zonesDomain = [];
            if (selected_zone) zonesDomain = [["id", "=", parseInt(selected_zone)]];
            const zones = await this.orm.searchRead("zone", zonesDomain, ["id", "name"], { order: "name asc" });

            // Pour chaque zone : réservations + véhicules en parallèle
            const rowPromises = zones.map(async (zone) => {
                const domainRes = [
                    ["status",           "=",  "confirmee"],
                    ["date_heure_debut", "<=", this._formatORM(fin)],
                    ["date_heure_fin",   ">=", this._formatORM(debut)],
                    ["zone",             "=",  zone.id],
                ];
                const domainVeh = [
                    ["zone",        "=",  zone.id],
                    ["active_test", "=",  true],
                ];

                const [resList, vehList] = await Promise.all([
                    this.orm.searchRead("reservation", domainRes, ["date_heure_debut", "date_heure_fin"]),
                    this.orm.searchRead("vehicule", domainVeh, ["id"]),
                ]);

                const nbVehicules = vehList.length;

                let joursReserves = 0;
                for (const r of resList) {
                    const deb = new Date(r.date_heure_debut);
                    const fn  = new Date(r.date_heure_fin);
                    const s   = deb < debut ? debut : deb;
                    const e   = fn  > fin   ? fin   : fn;
                    const j   = Math.ceil((e - s) / (1000 * 60 * 60 * 24));
                    if (j > 0) joursReserves += j;
                }

                let taux = 0;
                if (nbVehicules > 0 && nbJoursPeriode > 0) {
                    taux = Math.min(100, Math.round((joursReserves / (nbVehicules * nbJoursPeriode)) * 100));
                }

                return {
                    zone_id        : zone.id,
                    zone_name      : zone.name,
                    taux,
                    nbVehicules,
                    joursReserves,
                    nbJoursPeriode,
                };
            });

            this.state.rows = await Promise.all(rowPromises);

        } finally {
            this.state.loading = false;
            setTimeout(() => this._renderDetailChart(), 50);
        }
    }

    retour() {
        this.action.doAction("dashboard_analytics.action_taux_remplissage_dashboard");
    }

    tauxColor(val) {
        if (val >= 75) return "#16a34a";
        if (val >= 40) return "#ca8a04";
        return "#dc2626";
    }

    get moyenneDetail() {
        const rows = this.state.rows.filter(r => r.taux > 0);
        if (rows.length === 0) return 0;
        return Math.round(rows.reduce((s, r) => s + r.taux, 0) / rows.length);
    }

    _renderDetailChart() {
        const canvas = document.getElementById("trd-chart");
        if (!canvas) return;
        if (this._chart) { this._chart.destroy(); this._chart = null; }

        const labels = this.state.rows.map(r => r.zone_name);
        const data   = this.state.rows.map(r => r.taux);

        const draw = () => {
            this._chart = new Chart(canvas, {
                type: "bar",
                data: {
                    labels,
                    datasets: [{
                        label           : `Taux de remplissage (%)`,
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
                        y: {
                            beginAtZero: true, max: 100,
                            grid: { color: "rgba(0,0,0,.06)" },
                            ticks: { font: { weight: "600" }, callback: v => `${v} %` },
                        },
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
}

TauxRemplissageDetailDashboard.template = "dashboard_analytics.TauxRemplissageDetailDashboard";

registry
    .category("actions")
    .add("dashboard_analytics.action_taux_remplissage_detail_dashboard", TauxRemplissageDetailDashboard);