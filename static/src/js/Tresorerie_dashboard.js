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

    _DATE_PIVOT = new Date(2025, 10, 1, 0, 0, 0);

    _isAvantPivot(annee, mois) {
        return new Date(annee, mois - 1, 1, 0, 0, 0) < this._DATE_PIVOT;
    }

    async _fetchMoisTresorerie(annee, mois) {
        const taux  = this._getTaux(annee);
        const debut = new Date(annee, mois - 1, 1,  0,  0,  0);
        const fin   = new Date(annee, mois,     0, 23, 59, 59);

        const zoneId     = this.state.selected_zone ? parseInt(this.state.selected_zone) : null;
        const zoneFilter = zoneId ? [['zone_encaissement', '=', zoneId]] : [];
        const flagFilter = this._isAvantPivot(annee, mois)
            ? [['is_old', '=', true]]
            : [['is_old', '!=', true]];

        const domainAvecDate = [
            ...zoneFilter, ...flagFilter,
            ['date_encaissement', '>=', this._formatORM(debut)],
            ['date_encaissement', '<=', this._formatORM(fin)],
        ];

        const domainSansDate = [
            ...zoneFilter, ...flagFilter,
            ['date_encaissement', '=', false],
            ['reservation.create_date', '>=', this._formatORM(debut)],
            ['reservation.create_date', '<=', this._formatORM(fin)],
        ];

        const refundDomain = [
            ['date', '>=', this._formatORM(debut)],
            ['date', '<=', this._formatORM(fin)],
            ['status', '=', 'effectuer'],
        ];
        if (zoneId) refundDomain.push(['reservation.zone', '=', zoneId]);

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

    async _fetchZoneTresorerie(annee, zoneId) {
        const taux    = this._getTaux(annee);
        const debutAn = new Date(annee, 0,  1,  0,  0,  0);
        const finAn   = new Date(annee, 11, 31, 23, 59, 59);

        let totalRevenue = 0;

        if (debutAn < this._DATE_PIVOT) {
            const finOld = finAn < this._DATE_PIVOT
                ? finAn
                : new Date(2025, 9, 31, 23, 59, 59);

            const domOldAvec = [
                ['zone_encaissement', '=', zoneId], ['is_old', '=', true],
                ['date_encaissement', '>=', this._formatORM(debutAn)],
                ['date_encaissement', '<=', this._formatORM(finOld)],
            ];
            const domOldSans = [
                ['zone_encaissement', '=', zoneId], ['is_old', '=', true],
                ['date_encaissement', '=', false],
                ['reservation.create_date', '>=', this._formatORM(debutAn)],
                ['reservation.create_date', '<=', this._formatORM(finOld)],
            ];

            const [r1, r2] = await Promise.all([
                this.orm.readGroup("revenue.record", domOldAvec, ["montant_dzd:sum", "montant:sum"], []),
                this.orm.readGroup("revenue.record", domOldSans, ["montant_dzd:sum", "montant:sum"], []),
            ]);

            const o1 = r1[0] ?? {};
            const o2 = r2[0] ?? {};
            totalRevenue += (o1.montant_dzd ?? 0) + ((o1.montant ?? 0) * taux)
                          + (o2.montant_dzd ?? 0) + ((o2.montant ?? 0) * taux);
        }

        if (finAn >= this._DATE_PIVOT) {
            const debutNew = debutAn >= this._DATE_PIVOT ? debutAn : this._DATE_PIVOT;

            const domNewAvec = [
                ['zone_encaissement', '=', zoneId], ['is_old', '!=', true],
                ['date_encaissement', '>=', this._formatORM(debutNew)],
                ['date_encaissement', '<=', this._formatORM(finAn)],
            ];
            const domNewSans = [
                ['zone_encaissement', '=', zoneId], ['is_old', '!=', true],
                ['date_encaissement', '=', false],
                ['reservation.create_date', '>=', this._formatORM(debutNew)],
                ['reservation.create_date', '<=', this._formatORM(finAn)],
            ];

            const [r1, r2] = await Promise.all([
                this.orm.readGroup("revenue.record", domNewAvec, ["montant_dzd:sum", "montant:sum"], []),
                this.orm.readGroup("revenue.record", domNewSans, ["montant_dzd:sum", "montant:sum"], []),
            ]);

            const n1 = r1[0] ?? {};
            const n2 = r2[0] ?? {};
            totalRevenue += (n1.montant_dzd ?? 0) + ((n1.montant ?? 0) * taux)
                          + (n2.montant_dzd ?? 0) + ((n2.montant ?? 0) * taux);
        }

        const refundDomain = [
            ['date', '>=', this._formatORM(debutAn)],
            ['date', '<=', this._formatORM(finAn)],
            ['status', '=', 'effectuer'],
            ['reservation.zone', '=', zoneId],
        ];
        const resRefund  = await this.orm.readGroup("refund.table", refundDomain, ["amount:sum"], []);
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
            this.state.loading = false;
            setTimeout(() => {
                this._renderChart();
                this._renderChartLine();
            }, 50);
        }
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
        const label = `${this.state.rows[mois - 1]?.label} ${annee}`;

        this.action.doAction({
            type   : "ir.actions.client",
            tag    : "dashboard_analytics.action_tresorerie_detail_dashboard",
            name   : `Trésorerie — ${label}`,
            target : "current",
            params : {
                label,
                annee,
                mois,
                domain_params: {
                    annee,
                    mois,
                    selected_zone: this.state.selected_zone,
                },
            },
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


// ═══════════════════════════════════════════════════════════════════════════
//  COMPOSANT : TresorerieDetailDashboard
// ═══════════════════════════════════════════════════════════════════════════

export class TresorerieDetailDashboard extends Component {

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        const props  = this.props;
        const params = props.action?.params || {};

        this.state = useState({
            loading        : true,
            label          : params.label  || "",
            annee          : params.annee  || new Date().getFullYear(),
            mois           : params.mois   || new Date().getMonth() + 1,
            domain_params  : params.domain_params || {},
            zones          : [],
            lieux          : [],
            categories     : [],
            matrix_lieu    : {},
            matrix_zone    : {},
            totaux_lieux   : {},
            totaux_zones   : {},
            totaux_cats    : {},
            grand_total    : { montant: 0, count: 0 },
            expanded_zones : {},
            recs_raw       : [],
        });

        onWillStart(() => this._loadDetailData());
    }

    _pad(n) { return String(n).padStart(2, "0"); }

    _formatORM(d) {
        return `${d.getFullYear()}-${this._pad(d.getMonth()+1)}-${this._pad(d.getDate())} `
             + `${this._pad(d.getHours())}:${this._pad(d.getMinutes())}:${this._pad(d.getSeconds())}`;
    }

    _fmt(n) {
        return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    }

    _getTaux(annee) {
        return annee < 2026 ? 260 : 270;
    }

    _DATE_PIVOT = new Date(2025, 10, 1, 0, 0, 0);

    _isAvantPivot(annee, mois) {
        return new Date(annee, mois - 1, 1, 0, 0, 0) < this._DATE_PIVOT;
    }

    async _loadDetailData() {
        this.state.loading = true;
        try {
            const p      = this.state.domain_params;
            const annee  = p.annee  || this.state.annee;
            const mois   = p.mois   || this.state.mois;
            const zoneId = p.selected_zone ? parseInt(p.selected_zone) : null;
            const taux   = this._getTaux(annee);

            const debut = new Date(annee, mois - 1, 1,  0,  0,  0);
            const fin   = new Date(annee, mois,     0, 23, 59, 59);

            const flagFilter = this._isAvantPivot(annee, mois)
                ? [['is_old', '=', true]]
                : [['is_old', '!=', true]];

            const zoneFilter = zoneId ? [['zone_encaissement', '=', zoneId]] : [];

            // ── Domaine AVEC date_encaissement ──
            const domainAvecDate = [
                ...zoneFilter, ...flagFilter,
                ['date_encaissement', '>=', this._formatORM(debut)],
                ['date_encaissement', '<=', this._formatORM(fin)],
            ];

            // ── Domaine SANS date_encaissement (fallback create_date) ──
            const domainSansDate = [
                ...zoneFilter, ...flagFilter,
                ['date_encaissement', '=', false],
                ['reservation.create_date', '>=', this._formatORM(debut)],
                ['reservation.create_date', '<=', this._formatORM(fin)],
            ];

            // ── Domaine remboursements ──
            const refundDomain = [
                ['date', '>=', this._formatORM(debut)],
                ['date', '<=', this._formatORM(fin)],
                ['status', '=', 'effectuer'],
            ];
            if (zoneId) refundDomain.push(['reservation.zone', '=', zoneId]);

            const FIELDS_REC = ["id", "montant", "montant_dzd", "zone_encaissement", "reservation", "date_encaissement"];

            const [zones, lieux, categories, recsAvec, recsSans, refundRecs] = await Promise.all([
                this.orm.searchRead("zone", [], ["id", "name"], { order: "name asc" }),
                this.orm.searchRead("lieux", [], ["id", "name", "zone"], { order: "name asc" }),
                this.orm.searchRead("categorie.client", [], ["id", "name"], { order: "name asc" }),
                this.orm.searchRead("revenue.record", domainAvecDate, FIELDS_REC, { limit: 0 }),
                this.orm.searchRead("revenue.record", domainSansDate, FIELDS_REC, { limit: 0 }),
                this.orm.searchRead("refund.table", refundDomain, ["id", "amount", "reservation"], { limit: 0 }),
            ]);

            // ── Fusion des deux listes de records revenus ──
            const recs = [...recsAvec, ...recsSans];

            // ── Récupérer lieu_depart + categorie_client des réservations (revenus) ──
            const resIds = [...new Set(
                recs
                    .map(r => Array.isArray(r.reservation) ? r.reservation[0] : r.reservation)
                    .filter(Boolean)
            )];

            let resvMap = {};
            if (resIds.length > 0) {
                const resvData = await this.orm.searchRead(
                    "reservation",
                    [["id", "in", resIds]],
                    ["id", "lieu_depart", "categorie_client"],
                    { limit: 0 }
                );
                for (const rv of resvData) {
                    resvMap[rv.id] = {
                        lieu_id : Array.isArray(rv.lieu_depart)      ? rv.lieu_depart[0]      : rv.lieu_depart      || false,
                        cat_id  : Array.isArray(rv.categorie_client) ? rv.categorie_client[0] : rv.categorie_client || false,
                    };
                }
            }

            // ── Récupérer zone + lieu + categorie des réservations (remboursements) ──
            const refundResIds = [...new Set(
                refundRecs
                    .map(r => Array.isArray(r.reservation) ? r.reservation[0] : r.reservation)
                    .filter(Boolean)
            )];

            let refundResvMap = {};
            if (refundResIds.length > 0) {
                const refundResvData = await this.orm.searchRead(
                    "reservation",
                    [["id", "in", refundResIds]],
                    ["id", "zone", "lieu_depart", "categorie_client"],
                    { limit: 0 }
                );
                for (const rv of refundResvData) {
                    refundResvMap[rv.id] = {
                        zone_id : Array.isArray(rv.zone)             ? rv.zone[0]             : rv.zone             || false,
                        lieu_id : Array.isArray(rv.lieu_depart)      ? rv.lieu_depart[0]      : rv.lieu_depart      || false,
                        cat_id  : Array.isArray(rv.categorie_client) ? rv.categorie_client[0] : rv.categorie_client || false,
                    };
                }
            }

            this.state.zones      = zones;
            this.state.lieux      = lieux.map(l => ({
                ...l,
                zone_id: Array.isArray(l.zone) ? l.zone[0] : l.zone || false,
            }));
            this.state.categories = categories;
            this.state.recs_raw   = recs;

            const matrix_lieu  = {};
            const matrix_zone  = {};
            const totaux_lieux = {};
            const totaux_zones = {};
            const totaux_cats  = {};
            let grand_montant  = 0;
            let grand_count    = 0;

            // ── Additionner les revenus ──
            for (const rec of recs) {
                const res_id  = Array.isArray(rec.reservation) ? rec.reservation[0] : rec.reservation || false;
                const zone_id = Array.isArray(rec.zone_encaissement) ? rec.zone_encaissement[0] : rec.zone_encaissement || false;
                const rv      = res_id ? resvMap[res_id] : null;
                const lieu_id = rv?.lieu_id || false;
                const cat_id  = rv?.cat_id  || false;
                const montant = (rec.montant_dzd || 0) + ((rec.montant || 0) * taux);

                grand_montant += montant;
                grand_count++;

                if (zone_id) {
                    if (!matrix_zone[zone_id]) matrix_zone[zone_id] = {};
                    if (!matrix_zone[zone_id][cat_id]) matrix_zone[zone_id][cat_id] = { montant: 0, count: 0 };
                    matrix_zone[zone_id][cat_id].montant += montant;
                    matrix_zone[zone_id][cat_id].count++;
                    if (!totaux_zones[zone_id]) totaux_zones[zone_id] = { montant: 0, count: 0 };
                    totaux_zones[zone_id].montant += montant;
                    totaux_zones[zone_id].count++;
                }

                if (lieu_id) {
                    if (!matrix_lieu[lieu_id]) matrix_lieu[lieu_id] = {};
                    if (!matrix_lieu[lieu_id][cat_id]) matrix_lieu[lieu_id][cat_id] = { montant: 0, count: 0 };
                    matrix_lieu[lieu_id][cat_id].montant += montant;
                    matrix_lieu[lieu_id][cat_id].count++;
                    if (!totaux_lieux[lieu_id]) totaux_lieux[lieu_id] = { montant: 0, count: 0 };
                    totaux_lieux[lieu_id].montant += montant;
                    totaux_lieux[lieu_id].count++;
                }

                if (cat_id) {
                    if (!totaux_cats[cat_id]) totaux_cats[cat_id] = { montant: 0, count: 0 };
                    totaux_cats[cat_id].montant += montant;
                    totaux_cats[cat_id].count++;
                }
            }

            // ── Déduire les remboursements partout ──
            for (const ref of refundRecs) {
                const res_id  = Array.isArray(ref.reservation) ? ref.reservation[0] : ref.reservation || false;
                const rv      = res_id ? refundResvMap[res_id] : null;
                const zone_id = rv?.zone_id || false;
                const lieu_id = rv?.lieu_id || false;
                const cat_id  = rv?.cat_id  || false;
                const montant = (ref.amount || 0) * taux;

                grand_montant -= montant;

                if (zone_id) {
                    if (!matrix_zone[zone_id]) matrix_zone[zone_id] = {};
                    if (!matrix_zone[zone_id][cat_id]) matrix_zone[zone_id][cat_id] = { montant: 0, count: 0 };
                    matrix_zone[zone_id][cat_id].montant -= montant;
                    if (!totaux_zones[zone_id]) totaux_zones[zone_id] = { montant: 0, count: 0 };
                    totaux_zones[zone_id].montant -= montant;
                }

                if (lieu_id) {
                    if (!matrix_lieu[lieu_id]) matrix_lieu[lieu_id] = {};
                    if (!matrix_lieu[lieu_id][cat_id]) matrix_lieu[lieu_id][cat_id] = { montant: 0, count: 0 };
                    matrix_lieu[lieu_id][cat_id].montant -= montant;
                    if (!totaux_lieux[lieu_id]) totaux_lieux[lieu_id] = { montant: 0, count: 0 };
                    totaux_lieux[lieu_id].montant -= montant;
                }

                if (cat_id) {
                    if (!totaux_cats[cat_id]) totaux_cats[cat_id] = { montant: 0, count: 0 };
                    totaux_cats[cat_id].montant -= montant;
                }
            }

            this.state.matrix_lieu  = matrix_lieu;
            this.state.matrix_zone  = matrix_zone;
            this.state.totaux_lieux = totaux_lieux;
            this.state.totaux_zones = totaux_zones;
            this.state.totaux_cats  = totaux_cats;
            this.state.grand_total  = { montant: grand_montant, count: grand_count };

        } finally {
            this.state.loading = false;
            setTimeout(() => {
                this._renderChartJourSemaine();
                this._renderHeatmap();
            }, 50);
        }
    }

    toggleZone(zone_id) {
        this.state.expanded_zones[zone_id] = !this.state.expanded_zones[zone_id];
    }

    isZoneExpanded(zone_id) {
        return !!this.state.expanded_zones[zone_id];
    }

    getLieuxByZone(zone_id) {
        return this.state.lieux.filter(l => l.zone_id === zone_id);
    }

    getCellLieu(lieu_id, cat_id) { return this.state.matrix_lieu[lieu_id]?.[cat_id]  || { montant: 0, count: 0 }; }
    getCellZone(zone_id, cat_id) { return this.state.matrix_zone[zone_id]?.[cat_id]  || { montant: 0, count: 0 }; }
    getTotalLieu(lieu_id)        { return this.state.totaux_lieux[lieu_id] || { montant: 0, count: 0 }; }
    getTotalZone(zone_id)        { return this.state.totaux_zones[zone_id] || { montant: 0, count: 0 }; }
    getTotalCat(cat_id)          { return this.state.totaux_cats[cat_id]   || { montant: 0, count: 0 }; }

    fmtM(v) { return this._fmt(v); }

    retour() {
        this.action.doAction("dashboard_analytics.action_tresorerie_dashboard");
    }

    _renderChartJourSemaine() {
        const canvas = document.getElementById("trd-chart-jour-semaine");
        if (!canvas) return;
        if (this._chartJourSemaine) { this._chartJourSemaine.destroy(); this._chartJourSemaine = null; }

        const taux    = this._getTaux(this.state.domain_params.annee || this.state.annee);
        const JOURS   = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
        const montants = new Array(7).fill(0);
        const counts   = new Array(7).fill(0);

        for (const rec of this.state.recs_raw) {
            if (!rec.date_encaissement) continue;
            const d   = new Date(rec.date_encaissement);
            const idx = (d.getDay() + 6) % 7;
            montants[idx] += (rec.montant_dzd || 0) + ((rec.montant || 0) * taux);
            counts[idx]++;
        }

        const COLORS = [
            "rgba(107,15,58,0.82)","rgba(107,15,58,0.75)","rgba(107,15,58,0.68)",
            "rgba(107,15,58,0.62)","rgba(107,15,58,0.55)","rgba(190,18,60,0.75)","rgba(190,18,60,0.88)",
        ];

        const draw = () => {
            this._chartJourSemaine = new Chart(canvas, {
                type : "bar",
                data : {
                    labels   : JOURS,
                    datasets : [{
                        label           : "Trésorerie (DA)",
                        data            : montants.map(v => Math.round(v)),
                        backgroundColor : COLORS,
                        borderRadius    : 6,
                        borderSkipped   : false,
                    }],
                },
                options: {
                    responsive : true,
                    plugins: {
                        legend : { display: false },
                        tooltip: {
                            callbacks: {
                                label     : ctx => ` ${this._fmt(ctx.parsed.y)} DA`,
                                afterLabel: ctx => ` (${counts[ctx.dataIndex]} paiements)`,
                            },
                        },
                    },
                    scales: {
                        x : { grid: { display: false }, ticks: { font: { weight: "700" } } },
                        y : {
                            beginAtZero : true,
                            ticks       : { font: { weight: "600" } },
                            grid        : { color: "rgba(0,0,0,.06)" },
                            title       : { display: true, text: "DA" },
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

    _renderHeatmap() {
        const container = document.getElementById("trd-heatmap-container");
        if (!container) return;

        const taux   = this._getTaux(this.state.domain_params.annee || this.state.annee);
        const matrix = {};
        let maxVal   = 0;

        for (const rec of this.state.recs_raw) {
            if (!rec.date_encaissement) continue;
            const d      = new Date(rec.date_encaissement);
            const { week, year } = this._getISOWeek(d);
            const key    = `${year}-${String(week).padStart(2, "0")}`;
            if (!matrix[key]) matrix[key] = new Array(7).fill(0);
            const dayIdx = (d.getDay() + 6) % 7;
            matrix[key][dayIdx] += (rec.montant_dzd || 0) + ((rec.montant || 0) * taux);
        }

        for (const key of Object.keys(matrix)) {
            for (const v of matrix[key]) {
                if (v > maxVal) maxVal = v;
            }
        }

        const weekKeys     = Object.keys(matrix).sort();
        const JOURS_COURTS = ["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"];

        const cellSize = 28;
        const cellGap  = 3;
        const labelW   = 28;
        const headerH  = 36;
        const nWeeks   = weekKeys.length;
        const svgW     = labelW + nWeeks * (cellSize + cellGap);
        const svgH     = headerH + 7 * (cellSize + cellGap);

        let cells = "";

        weekKeys.forEach((key, wi) => {
            if (wi % 4 === 0) {
                const wk = key.split("-")[1];
                const x  = labelW + wi * (cellSize + cellGap) + cellSize / 2;
                cells += `<text x="${x}" y="14" text-anchor="middle" font-size="9" fill="#94a3b8" font-weight="600">S${wk}</text>`;
            }
        });

        JOURS_COURTS.forEach((j, di) => {
            const y = headerH + di * (cellSize + cellGap) + cellSize / 2 + 4;
            cells += `<text x="${labelW - 4}" y="${y}" text-anchor="end" font-size="10" fill="#64748b" font-weight="700">${j}</text>`;
        });

        weekKeys.forEach((key, wi) => {
            for (let di = 0; di < 7; di++) {
                const val       = matrix[key][di] || 0;
                const x         = labelW + wi * (cellSize + cellGap);
                const y         = headerH + di * (cellSize + cellGap);
                const intensity = maxVal > 0 ? val / maxVal : 0;
                const fill      = val === 0 ? "#f1f5f9" : this._heatColor(intensity);
                const textColor = intensity > 0.5 ? "#fff" : "#1e293b";

                cells += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="4" fill="${fill}">
                    <title>Semaine ${key} — ${JOURS_COURTS[di]} : ${this._fmt(val)} DA</title>
                </rect>`;

                if (val > 0) {
                    const lbl = val >= 1000000
                        ? Math.round(val / 1000000) + "M"
                        : val >= 1000
                            ? Math.round(val / 1000) + "k"
                            : String(Math.round(val));
                    cells += `<text x="${x + cellSize/2}" y="${y + cellSize/2 + 4}" text-anchor="middle" font-size="8" fill="${textColor}" font-weight="700">${lbl}</text>`;
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
        if (t <= 0) return "#f1f5f9";
        if (t < 0.33) {
            const r = Math.round(254 + (190 - 254) * (t / 0.33));
            const g = Math.round(202 + (18  - 202) * (t / 0.33));
            const b = Math.round(202 + (60  - 202) * (t / 0.33));
            return `rgb(${r},${g},${b})`;
        }
        if (t < 0.66) {
            const tt = (t - 0.33) / 0.33;
            const r  = Math.round(190 + (107 - 190) * tt);
            const g  = Math.round(18  + (15  - 18)  * tt);
            const b  = Math.round(60  + (58  - 60)  * tt);
            return `rgb(${r},${g},${b})`;
        }
        const tt = (t - 0.66) / 0.34;
        const r  = Math.round(107 + (50  - 107) * tt);
        const g  = Math.round(15  + (5   - 15)  * tt);
        const b  = Math.round(58  + (30  - 58)  * tt);
        return `rgb(${r},${g},${b})`;
    }

    _getISOWeek(d) {
        const date      = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const day       = date.getUTCDay() || 7;
        date.setUTCDate(date.getUTCDate() + 4 - day);
        const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
        const week      = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
        return { week, year: date.getUTCFullYear() };
    }
}

TresorerieDetailDashboard.template = "dashboard_analytics.TresorerieDetailDashboard";

registry
    .category("actions")
    .add("dashboard_analytics.action_tresorerie_detail_dashboard", TresorerieDetailDashboard);