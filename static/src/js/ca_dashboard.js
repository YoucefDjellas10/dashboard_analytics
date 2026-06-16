/** @odoo-module **/

import { registry }   from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Component, onWillStart, useState } from "@odoo/owl";

export class CaDashboard extends Component {

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

    _fmt(n) {
        return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    }

    _buildDomainRes(annee, mois) {
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

    async _fetchMoisCA(annee, mois) {
        const debut = new Date(annee, mois - 1, 1,  0,  0,  0);
        const fin   = new Date(annee, mois,     0, 23, 59, 59);

        const domain = [
            ["status",      "=",  "confirmee"],
            ["create_date", ">=", this._formatORM(debut)],
            ["create_date", "<=", this._formatORM(fin)],
        ];
        if (this.state.selected_zone)
            domain.push(["zone", "=", parseInt(this.state.selected_zone)]);

        const [resResult, tauxResult] = await Promise.all([
            this.orm.readGroup("reservation", domain, ["total_reduit_euro:sum"], []),
            this.orm.searchRead("taux.change", [["id", "=", 2]], ["montant"], { limit: 1 }),
        ]);

        const caEuro = (resResult[0] ?? {}).total_reduit_euro ?? 0;
        const taux   = tauxResult[0]?.montant ?? 1;

        return caEuro * taux;
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
                promises.push(this._fetchMoisCA(n1, m));
                promises.push(this._fetchMoisCA(n,  m));
            }

            const results = await Promise.all(promises);

            const rows = [];
            for (let m = 1; m <= 12; m++) {
                const idx    = (m - 1) * 2;
                const ca_n1  = results[idx];
                const ca_n   = results[idx + 1];

                let delta = null;
                if (ca_n1 > 0) {
                    delta = Math.round(((ca_n - ca_n1) / ca_n1) * 100);
                } else if (ca_n > 0) {
                    delta = 100;
                }

                rows.push({
                    mois  : m,
                    label : MOIS_LABELS[m - 1],
                    ca_n1,
                    ca_n,
                    delta,
                });
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
        const MOIS_LABELS = [
            "Janvier","Février","Mars","Avril","Mai","Juin",
            "Juillet","Août","Septembre","Octobre","Novembre","Décembre"
        ];
        const label = MOIS_LABELS[mois - 1] ?? "";

        this.action.doAction({
            type    : "ir.actions.client",
            tag     : "dashboard_analytics.action_roi_dashboard",
            name    : `ROI — ${label} ${annee}`,
            target  : "current",
            context : {
                roi_annee      : annee,
                roi_mois       : mois,
                roi_mois_label : label,
                roi_zone       : this.state.selected_zone,
            },
        });
    }

    async _loadPieData() {
        const n     = this.state.annee_n;
        const zones = await this.orm.searchRead("zone", [], ["id", "name"], { order: "name asc" });

        const results = await Promise.all(
            zones.map(z => this._fetchMoisCAZone(n, z.id))
        );

        this.state.pie_data = zones.map((z, i) => ({
            zone_name : z.name,
            ca        : results[i],
        })).filter(r => r.ca > 0);
    }

    async _loadPieDataN1() {
        const n1    = this.state.annee_n1;
        const zones = await this.orm.searchRead("zone", [], ["id", "name"], { order: "name asc" });

        const results = await Promise.all(
            zones.map(z => this._fetchMoisCAZone(n1, z.id))
        );

        this.state.pie_data_n1 = zones.map((z, i) => ({
            zone_name : z.name,
            ca        : results[i],
        })).filter(r => r.ca > 0);
    }

    async _fetchMoisCAZone(annee, zoneId) {
        const debut = new Date(annee, 0,  1,  0,  0,  0);
        const fin   = new Date(annee, 11, 31, 23, 59, 59);

        const domain = [
            ["status",      "=",  "confirmee"],
            ["create_date", ">=", this._formatORM(debut)],
            ["create_date", "<=", this._formatORM(fin)],
            ["zone",        "=",  zoneId],
        ];

        const [resResult, tauxResult] = await Promise.all([
            this.orm.readGroup("reservation", domain, ["total_reduit_euro:sum"], []),
            this.orm.searchRead("taux.change", [["id", "=", 2]], ["montant"], { limit: 1 }),
        ]);

        const caEuro = (resResult[0] ?? {}).total_reduit_euro ?? 0;
        const taux   = tauxResult[0]?.montant ?? 1;

        return caEuro * taux;
    }

    _renderChart() {
        const canvas = document.getElementById("ca-chart");
        if (!canvas) return;
        if (this._chart) { this._chart.destroy(); this._chart = null; }

        const labels = this.state.rows.map(r => r.label);
        const dataN1 = this.state.rows.map(r => Math.round(r.ca_n1));
        const dataN  = this.state.rows.map(r => Math.round(r.ca_n));

        const draw = () => {
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
                    responsive          : true,
                    maintainAspectRatio : true,
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
        const canvas = document.getElementById("ca-chart-line");
        if (!canvas) return;
        if (this._chartLine) { this._chartLine.destroy(); this._chartLine = null; }

        const labels = this.state.rows.map(r => r.label);
        const dataN1 = this.state.rows.map(r => Math.round(r.ca_n1));
        const dataN  = this.state.rows.map(r => Math.round(r.ca_n));

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
        const canvas = document.getElementById("ca-chart-pie");
        if (!canvas) return;
        if (this._chartPie) { this._chartPie.destroy(); this._chartPie = null; }

        const labels = this.state.pie_data.map(r => r.zone_name);
        const data   = this.state.pie_data.map(r => Math.round(r.ca));

        const COLORS = [
            "rgba(21,101,192,0.85)","rgba(106,27,154,0.85)","rgba(22,163,74,0.85)",
            "rgba(220,38,38,0.85)","rgba(234,179,8,0.85)","rgba(14,116,144,0.85)",
            "rgba(249,115,22,0.85)","rgba(99,102,241,0.85)",
        ];

        const draw = () => {
            this._chartPie = new Chart(canvas, {
                type : "pie",
                data : { labels, datasets: [{ data, backgroundColor: COLORS.slice(0, labels.length), borderWidth: 2, borderColor: "#fff" }] },
                options: {
                    responsive : true,
                    plugins: {
                        legend  : { position: "bottom", labels: { font: { weight: "600" }, padding: 16 } },
                        tooltip : { callbacks: { label: ctx => ` ${ctx.label} : ${this._fmt(ctx.parsed)} DA` } },
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
        const canvas = document.getElementById("ca-chart-pie-n1");
        if (!canvas) return;
        if (this._chartPieN1) { this._chartPieN1.destroy(); this._chartPieN1 = null; }

        const labels = this.state.pie_data_n1.map(r => r.zone_name);
        const data   = this.state.pie_data_n1.map(r => Math.round(r.ca));

        const COLORS = [
            "rgba(21,101,192,0.85)","rgba(106,27,154,0.85)","rgba(22,163,74,0.85)",
            "rgba(220,38,38,0.85)","rgba(234,179,8,0.85)","rgba(14,116,144,0.85)",
            "rgba(249,115,22,0.85)","rgba(99,102,241,0.85)",
        ];

        const draw = () => {
            this._chartPieN1 = new Chart(canvas, {
                type : "pie",
                data : { labels, datasets: [{ data, backgroundColor: COLORS.slice(0, labels.length), borderWidth: 2, borderColor: "#fff" }] },
                options: {
                    responsive : true,
                    plugins: {
                        legend  : { position: "bottom", labels: { font: { weight: "600" }, padding: 16 } },
                        tooltip : { callbacks: { label: ctx => ` ${ctx.label} : ${this._fmt(ctx.parsed)} DA` } },
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

    get totalN1()    { return this.state.rows.reduce((s, r) => s + r.ca_n1, 0); }
    get totalN()     { return this.state.rows.reduce((s, r) => s + r.ca_n,  0); }
    get totalN1Fmt() { return this._fmt(this.totalN1); }
    get totalNFmt()  { return this._fmt(this.totalN); }

    get totalDelta() {
        if (this.totalN1 === 0) return this.totalN > 0 ? 100 : null;
        return Math.round(((this.totalN - this.totalN1) / this.totalN1) * 100);
    }

    fmtRow(val) { return this._fmt(val); }
}

CaDashboard.template = "dashboard_analytics.CaDashboard";

registry
    .category("actions")
    .add("dashboard_analytics.action_ca_dashboard", CaDashboard);


// ═══════════════════════════════════════════════════════════
//  ROI DASHBOARD  (CA départ + Encaissement sur la même page)
// ═══════════════════════════════════════════════════════════

export class RoiDashboard extends Component {

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        const ctx         = this.props.action?.context ?? {};
        const currentYear = new Date().getFullYear();

        this.currentMonth = new Date().getMonth() + 1;
        this.currentYear  = currentYear;

        const annee    = ctx.roi_annee ?? currentYear;
        const nbLignes = (annee === currentYear) ? this.currentMonth : 12;

        this.state = useState({
            loading     : true,
            annee       : annee,
            mois_label  : ctx.roi_mois_label ?? "",
            zone        : ctx.roi_zone       ?? "",
            nb_lignes   : nbLignes,
            // ── ROI CA (départ)
            matrix      : [],
            totaux_col  : new Array(12).fill(0),
            totaux_row  : [],
            grand_total : 0,
            // ── ROI Encaissement
            loading_enc    : true,
            matrix_enc     : [],
            totaux_col_enc : new Array(12).fill(0),
            totaux_row_enc : [],
            grand_total_enc: 0,
        });

        onWillStart(() => Promise.all([this.loadData(), this.loadDataEnc()]));
    }

    _pad(n) { return String(n).padStart(2, "0"); }

    _formatORM(d) {
        return `${d.getFullYear()}-${this._pad(d.getMonth()+1)}-${this._pad(d.getDate())} `
             + `${this._pad(d.getHours())}:${this._pad(d.getMinutes())}:${this._pad(d.getSeconds())}`;
    }

    _fmt(n) {
        return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    }

    // ─────────────────────────────────────────
    //  ROI CA — chargement
    // ─────────────────────────────────────────
    async loadData() {
        this.state.loading = true;
        try {
            const annee    = this.state.annee;
            const nbLignes = this.state.nb_lignes;

            const tauxResult = await this.orm.searchRead(
                "taux.change", [["id", "=", 2]], ["montant"], { limit: 1 }
            );
            const taux = tauxResult[0]?.montant ?? 1;

            const promises = [];
            for (let mc = 1; mc <= nbLignes; mc++) {
                for (let md = 1; md <= 12; md++) {
                    promises.push(this._fetchCell(annee, mc, md));
                }
            }

            const results = await Promise.all(promises);

            const matrix      = [];
            const totaux_row  = new Array(nbLignes).fill(0);
            const totaux_col  = new Array(12).fill(0);
            let   grand_total = 0;

            for (let mc = 0; mc < nbLignes; mc++) {
                matrix[mc] = [];
                for (let md = 0; md < 12; md++) {
                    const ca = results[mc * 12 + md] * taux;
                    matrix[mc][md]  = ca;
                    totaux_row[mc] += ca;
                    totaux_col[md] += ca;
                    grand_total    += ca;
                }
            }

            this.state.matrix      = matrix;
            this.state.totaux_row  = totaux_row;
            this.state.totaux_col  = totaux_col;
            this.state.grand_total = grand_total;

        } finally {
            this.state.loading = false;
        }
    }

    async _fetchCell(annee, mois_creation, mois_depart) {
        const cDebut = new Date(annee, mois_creation - 1, 1,  0,  0,  0);
        const cFin   = new Date(annee, mois_creation,     0, 23, 59, 59);
        const dDebut = new Date(annee, mois_depart - 1,   1,  0,  0,  0);
        const dFin   = new Date(annee, mois_depart,       0, 23, 59, 59);

        const domain = [
            ["status",           "=",  "confirmee"],
            ["create_date",      ">=", this._formatORM(cDebut)],
            ["create_date",      "<=", this._formatORM(cFin)],
            ["date_heure_debut", ">=", this._formatORM(dDebut)],
            ["date_heure_debut", "<=", this._formatORM(dFin)],
        ];
        if (this.state.zone)
            domain.push(["zone", "=", parseInt(this.state.zone)]);

        const res = await this.orm.readGroup(
            "reservation", domain, ["total_reduit_euro:sum"], []
        );
        return (res[0] ?? {}).total_reduit_euro ?? 0;
    }

    // ─────────────────────────────────────────
    //  ROI Encaissement — chargement
    // ─────────────────────────────────────────
    async loadDataEnc() {
        this.state.loading_enc = true;
        try {
            const annee    = this.state.annee;
            const nbLignes = this.state.nb_lignes;

            const tauxResult = await this.orm.searchRead(
                "taux.change", [["id", "=", 2]], ["montant"], { limit: 1 }
            );
            const taux = tauxResult[0]?.montant ?? 1;

            const promises = [];
            for (let mc = 1; mc <= nbLignes; mc++) {
                for (let me = 1; me <= 12; me++) {
                    promises.push(this._fetchCellEnc(annee, mc, me));
                }
            }

            const results = await Promise.all(promises);

            const matrix      = [];
            const totaux_row  = new Array(nbLignes).fill(0);
            const totaux_col  = new Array(12).fill(0);
            let   grand_total = 0;

            for (let mc = 0; mc < nbLignes; mc++) {
                matrix[mc] = [];
                for (let me = 0; me < 12; me++) {
                    const r  = results[mc * 12 + me];
                    const ca = r.montant_eur * taux + r.montant_dzd;
                    matrix[mc][me]  = ca;
                    totaux_row[mc] += ca;
                    totaux_col[me] += ca;
                    grand_total    += ca;
                }
            }

            this.state.matrix_enc      = matrix;
            this.state.totaux_row_enc  = totaux_row;
            this.state.totaux_col_enc  = totaux_col;
            this.state.grand_total_enc = grand_total;

        } finally {
            this.state.loading_enc = false;
        }
    }

    async _fetchCellEnc(annee, mois_creation, mois_encaissement) {
        const cDebut = new Date(annee, mois_creation     - 1, 1,  0,  0,  0);
        const cFin   = new Date(annee, mois_creation,         0, 23, 59, 59);
        const eDebut = new Date(annee, mois_encaissement - 1, 1,  0,  0,  0);
        const eFin   = new Date(annee, mois_encaissement,     0, 23, 59, 59);

        const baseDomain = [
            ["create_date", ">=", this._formatORM(cDebut)],
            ["create_date", "<=", this._formatORM(cFin)],
        ];
        if (this.state.zone)
            baseDomain.push(["reservation.zone", "=", parseInt(this.state.zone)]);

        // Cas 1 — date_encaissement renseignée
        const domainA = [
            ...baseDomain,
            ["date_encaissement", "!=", false],
            ["date_encaissement", ">=", this._formatORM(eDebut)],
            ["date_encaissement", "<=", this._formatORM(eFin)],
        ];

        // Cas 2 — date_encaissement vide → fallback reservation.create_date
        const domainB = [
            ...baseDomain,
            ["date_encaissement", "=",  false],
            ["reservation.create_date", ">=", this._formatORM(eDebut)],
            ["reservation.create_date", "<=", this._formatORM(eFin)],
        ];

        const [resA, resB] = await Promise.all([
            this.orm.readGroup("revenue.record", domainA, ["montant:sum", "montant_dzd:sum"], []),
            this.orm.readGroup("revenue.record", domainB, ["montant:sum", "montant_dzd:sum"], []),
        ]);

        return {
            montant_eur : ((resA[0] ?? {}).montant     ?? 0) + ((resB[0] ?? {}).montant     ?? 0),
            montant_dzd : ((resA[0] ?? {}).montant_dzd ?? 0) + ((resB[0] ?? {}).montant_dzd ?? 0),
        };
    }

    // ─────────────────────────────────────────
    //  Actions communes
    // ─────────────────────────────────────────
    retour() {
        this.action.doAction("dashboard_analytics.action_ca_dashboard");
    }

    ouvrirDetail(mois_creation, mois_depart) {
        const MOIS = ["Janvier","Février","Mars","Avril","Mai","Juin",
                      "Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
        const annee = this.state.annee;

        const cDebut = new Date(annee, mois_creation - 1, 1,  0,  0,  0);
        const cFin   = new Date(annee, mois_creation,     0, 23, 59, 59);
        const dDebut = new Date(annee, mois_depart   - 1, 1,  0,  0,  0);
        const dFin   = new Date(annee, mois_depart,       0, 23, 59, 59);

        const domain = [
            ["status",           "=",  "confirmee"],
            ["create_date",      ">=", this._formatORM(cDebut)],
            ["create_date",      "<=", this._formatORM(cFin)],
            ["date_heure_debut", ">=", this._formatORM(dDebut)],
            ["date_heure_debut", "<=", this._formatORM(dFin)],
        ];
        if (this.state.zone)
            domain.push(["zone", "=", parseInt(this.state.zone)]);

        this.action.doAction({
            type      : "ir.actions.act_window",
            name      : `Créées en ${MOIS[mois_creation-1]} → Départ ${MOIS[mois_depart-1]} ${annee}`,
            res_model : "reservation",
            view_mode : "list,form",
            domain,
        });
    }

    ouvrirDetailEnc(mois_creation, mois_encaissement) {
        const MOIS = ["Janvier","Février","Mars","Avril","Mai","Juin",
                      "Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
        const annee = this.state.annee;

        const cDebut = new Date(annee, mois_creation     - 1, 1,  0,  0,  0);
        const cFin   = new Date(annee, mois_creation,         0, 23, 59, 59);
        const eDebut = new Date(annee, mois_encaissement - 1, 1,  0,  0,  0);
        const eFin   = new Date(annee, mois_encaissement,     0, 23, 59, 59);

        const baseDomain = [
            ["create_date", ">=", this._formatORM(cDebut)],
            ["create_date", "<=", this._formatORM(cFin)],
        ];
        if (this.state.zone)
            baseDomain.push(["reservation.zone", "=", parseInt(this.state.zone)]);

        const domain = [
            ...baseDomain,
            "|",
            "&", "&",
            ["date_encaissement", "!=", false],
            ["date_encaissement", ">=", this._formatORM(eDebut)],
            ["date_encaissement", "<=", this._formatORM(eFin)],
            "&", "&",
            ["date_encaissement", "=",  false],
            ["reservation.create_date", ">=", this._formatORM(eDebut)],
            ["reservation.create_date", "<=", this._formatORM(eFin)],
        ];

        this.action.doAction({
            type      : "ir.actions.act_window",
            name      : `Encaissements — Créés ${MOIS[mois_creation-1]} → Encaissés ${MOIS[mois_encaissement-1]} ${annee}`,
            res_model : "revenue.record",
            view_mode : "list,form",
            domain,
        });
    }

    fmtCell(val) {
        if (!val || val < 1) return "—";
        return this._fmt(val);
    }

    get grandTotalFmt() {
        if (!this.state.grand_total) return "0";
        return this._fmt(this.state.grand_total);
    }

    get grandTotalEncFmt() {
        return this._fmt(this.state.grand_total_enc || 0);
    }

    get MOIS_LABELS_LIGNES() {
        const all = ["Jan","Fév","Mar","Avr","Mai","Jun",
                     "Jul","Aoû","Sep","Oct","Nov","Déc"];
        return all.slice(0, this.state.nb_lignes);
    }

    get MOIS_LABELS_COLONNES() {
        return ["Jan","Fév","Mar","Avr","Mai","Jun",
                "Jul","Aoû","Sep","Oct","Nov","Déc"];
    }
}

RoiDashboard.template = "dashboard_analytics.RoiDashboard";

registry
    .category("actions")
    .add("dashboard_analytics.action_roi_dashboard", RoiDashboard);