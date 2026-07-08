/** @odoo-module **/

import { registry }   from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Component, onWillStart, useState } from "@odoo/owl";

const MOIS_LABELS = [
    "Janvier","Février","Mars","Avril","Mai","Juin",
    "Juillet","Août","Septembre","Octobre","Novembre","Décembre"
];

export class VehiculeDashboard extends Component {

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        const { debut, fin } = this._getDebutFinMois();

        this.state = useState({
            loading         : false,
            zones           : [],
            selected_zone   : "",
            date_debut      : this._toInputDate(debut),
            date_fin        : this._toInputDate(fin),

            categories      : [],
            total_valeur    : 0,
            total_count     : 0,
            total_revenu    : 0,
            total_depense   : 0,
            total_balance   : 0,

            expanded_cats   : {},
            expanded_mods   : {},
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

    _toInputDate(d) {
        return `${d.getFullYear()}-${this._pad(d.getMonth()+1)}-${this._pad(d.getDate())}`;
    }

    _parseDebut(str) {
        const [y, m, d] = str.split("-").map(Number);
        return new Date(y, m-1, d, 0, 0, 0);
    }

    _parseFin(str) {
        const [y, m, d] = str.split("-").map(Number);
        return new Date(y, m-1, d, 23, 59, 59);
    }

    _getDebutFinMois() {
        const now = new Date();
        return {
            debut : new Date(now.getFullYear(), now.getMonth(),     1,  0,  0,  0),
            fin   : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
        };
    }

    // Pivot du flag is_old (revenue.record "ancien" vs "nouveau")
    _DATE_PIVOT = new Date(2025, 10, 1, 0, 0, 0);

    // Pivot du taux EUR→DA : 260 avant 2026, 270 à partir de 2026
    _TAUX_PIVOT = new Date(2026, 0, 1, 0, 0, 0);

    // Découpe [debut..fin] aux deux pivots (is_old et taux) et attache
    // à chaque segment le flag is_old et le taux EUR→DA applicables.
    _buildSegments(debut, fin) {
        const cuts = [this._DATE_PIVOT, this._TAUX_PIVOT]
            .filter(p => p > debut && p <= fin)
            .sort((a, b) => a - b);
        const segments = [];
        let start = debut;
        for (const cut of cuts) {
            segments.push({ start, end: new Date(cut - 1) });
            start = cut;
        }
        segments.push({ start, end: fin });
        return segments.map(seg => ({
            ...seg,
            isOld : seg.start < this._DATE_PIVOT,
            taux  : seg.start < this._TAUX_PIVOT ? 260 : 270,
        }));
    }

    async _loadZones() {
        this.state.zones = await this.orm.searchRead(
            "zone", [], ["id", "name"], { order: "name asc" }
        );
    }

    // ─────────────────────────────────────────
    //  Chargement des données
    // ─────────────────────────────────────────

    async loadData() {
        if (!this.state.date_debut || !this.state.date_fin) return;
        this.state.loading = true;
        try {
            const debut  = this._parseDebut(this.state.date_debut);
            const fin    = this._parseFin(this.state.date_fin);
            const zoneId = this.state.selected_zone ? parseInt(this.state.selected_zone) : null;

            const finVehiculeStr = `${fin.getFullYear()}-${this._pad(fin.getMonth()+1)}-${this._pad(fin.getDate())}`;
            const debutStr = `${debut.getFullYear()}-${this._pad(debut.getMonth()+1)}-${this._pad(debut.getDate())}`;

            const zoneFilterRevenue = zoneId ? [["zone_encaissement", "=", zoneId]] : [];

            // ── Domaines Revenue : segmentés par pivot is_old + pivot taux.
            // Même formule que TresorerieDetailDashboard :
            // montant_dzd + (montant EUR × taux du segment) ──
            const segments   = this._buildSegments(debut, fin);
            const FIELDS_REV = ["id", "montant", "montant_dzd", "vehicule"];

            const revenuePromises = [];
            for (const seg of segments) {
                const flagFilter = seg.isOld ? [["is_old", "=", true]] : [["is_old", "!=", true]];
                revenuePromises.push(
                    this.orm.searchRead("revenue.record", [
                        ...zoneFilterRevenue, ...flagFilter,
                        ["date_encaissement", ">=", this._formatORM(seg.start)],
                        ["date_encaissement", "<=", this._formatORM(seg.end)],
                    ], FIELDS_REV, { limit: 0 }).then(recs => recs.map(r => ({ ...r, _taux: seg.taux }))),
                    this.orm.searchRead("revenue.record", [
                        ...zoneFilterRevenue, ...flagFilter,
                        ["date_encaissement", "=", false],
                        ["reservation.create_date", ">=", this._formatORM(seg.start)],
                        ["reservation.create_date", "<=", this._formatORM(seg.end)],
                    ], FIELDS_REV, { limit: 0 }).then(recs => recs.map(r => ({ ...r, _taux: seg.taux }))),
                );
            }

            // ── Domaine dépenses (identique au DepenseDashboard) ──
            const depenseDomain = [
                ["status",              "=",  "valide"],
                ["date_de_realisation", ">=", debutStr],
                ["date_de_realisation", "<=", finVehiculeStr],
            ];
            if (zoneId) depenseDomain.push(["zone", "=", zoneId]);

            // ── Domaine remboursements, segmentés avec le même taux ──
            const refundPromises = segments.map(seg => {
                const domain = [
                    ["date", ">=", this._formatORM(seg.start)],
                    ["date", "<=", this._formatORM(seg.end)],
                    ["status", "=", "effectuer"],
                ];
                if (zoneId) domain.push(["reservation.zone", "=", zoneId]);
                return this.orm.searchRead("refund.table", domain, ["id", "amount", "reservation"], { limit: 0 })
                    .then(recs => recs.map(r => ({ ...r, _taux: seg.taux })));
            });

            // ── Véhicules actifs (mise en service <= fin de période) ──
            const vehiculeDomain = [
                ["active_test", "=", true],
                ["date_debut_service", "<=", finVehiculeStr],
            ];
            if (zoneId) vehiculeDomain.push(["zone", "=", zoneId]);

            const [vehicules, depenses, refundParts, ...revenueParts] = await Promise.all([
                this.orm.searchRead("vehicule", vehiculeDomain,
                    ["id", "matricule", "numero", "categorie", "model_name", "valeur_actuel"]),
                this.orm.searchRead("depense.record", depenseDomain,
                    ["id", "montant_da", "vehicule_numero"], { limit: 0 }),
                Promise.all(refundPromises),
                ...revenuePromises,
            ]);

            const revenueRecs = [].concat(...revenueParts);
            const refunds     = [].concat(...refundParts);

            // ── Map vehicule → reservation (pour rattacher les remboursements) ──
            const refundResIds = [...new Set(
                refunds.map(r => Array.isArray(r.reservation) ? r.reservation[0] : r.reservation).filter(Boolean)
            )];
            let refundResvMap = {};
            if (refundResIds.length > 0) {
                const resvData = await this.orm.searchRead(
                    "reservation", [["id", "in", refundResIds]], ["id", "vehicule"], { limit: 0 }
                );
                for (const rv of resvData) {
                    refundResvMap[rv.id] = Array.isArray(rv.vehicule) ? rv.vehicule[0] : rv.vehicule || false;
                }
            }

            // ── Agrégation par véhicule ──
            const revenuMap  = {};
            const depenseMap = {};
            const refundMap  = {};

            for (const r of revenueRecs) {
                const vehId = Array.isArray(r.vehicule) ? r.vehicule[0] : r.vehicule || false;
                if (!vehId) continue;
                // Même formule que le tableau trésorerie : EUR converti au taux du segment
                const montant = (r.montant_dzd || 0) + ((r.montant || 0) * r._taux);
                revenuMap[vehId] = (revenuMap[vehId] || 0) + montant;
            }

            for (const d of depenses) {
                const vehId = Array.isArray(d.vehicule_numero) ? d.vehicule_numero[0] : d.vehicule_numero || false;
                if (!vehId) continue;
                depenseMap[vehId] = (depenseMap[vehId] || 0) + (d.montant_da || 0);
            }

            for (const ref of refunds) {
                const resId = Array.isArray(ref.reservation) ? ref.reservation[0] : ref.reservation || false;
                const vehId = resId ? refundResvMap[resId] : false;
                if (!vehId) continue;
                refundMap[vehId] = (refundMap[vehId] || 0) + ((ref.amount || 0) * ref._taux);
            }

            // ── Construction de l'arborescence Catégorie → Modèle → Véhicule ──
            const catMap = {};
            let total_valeur = 0, total_revenu = 0, total_depense = 0;

            for (const v of vehicules) {
                const catId   = Array.isArray(v.categorie) ? v.categorie[0] : 0;
                const catName = Array.isArray(v.categorie) ? v.categorie[1] : "Sans catégorie";
                const modName = v.model_name || "Sans modèle";
                const valeur  = v.valeur_actuel || 0;

                const revenu  = (revenuMap[v.id]  || 0) - (refundMap[v.id] || 0);
                const depense = depenseMap[v.id] || 0;
                const balance = revenu - depense;

                total_valeur  += valeur;
                total_revenu  += revenu;
                total_depense += depense;

                if (!catMap[catId]) {
                    catMap[catId] = {
                        id: catId, name: catName,
                        total_valeur: 0, total_count: 0,
                        total_revenu: 0, total_depense: 0, total_balance: 0,
                        modeles: {},
                    };
                }
                const cat = catMap[catId];

                if (!cat.modeles[modName]) {
                    cat.modeles[modName] = {
                        name: modName,
                        total_valeur: 0, total_count: 0,
                        total_revenu: 0, total_depense: 0, total_balance: 0,
                        vehicules: [],
                    };
                }
                const mod = cat.modeles[modName];

                mod.vehicules.push({
                    id        : v.id,
                    matricule : v.matricule,
                    numero    : v.numero,
                    valeur, revenu, depense, balance,
                });

                mod.total_valeur  += valeur;
                mod.total_count   += 1;
                mod.total_revenu  += revenu;
                mod.total_depense += depense;
                mod.total_balance += balance;

                cat.total_valeur  += valeur;
                cat.total_count   += 1;
                cat.total_revenu  += revenu;
                cat.total_depense += depense;
                cat.total_balance += balance;
            }

            // Catégories triées A→Z ; modèles/véhicules par valeur décroissante.
            const categories = Object.values(catMap).map(cat => {
                const modeles = Object.values(cat.modeles)
                    .map(mod => {
                        mod.vehicules.sort((a, b) => b.valeur - a.valeur);
                        return mod;
                    })
                    .sort((a, b) => b.total_valeur - a.total_valeur);
                return { ...cat, modeles };
            }).sort((a, b) => a.name.localeCompare(b.name));

            this.state.categories    = categories;
            this.state.total_valeur  = total_valeur;
            this.state.total_count   = vehicules.length;
            this.state.total_revenu  = total_revenu;
            this.state.total_depense = total_depense;
            this.state.total_balance = total_revenu - total_depense;

        } finally {
            this.state.loading = false;
            setTimeout(() => this._renderChartBalance(), 50);
        }
    }

    // ─────────────────────────────────────────
    //  Navigation vers le détail véhicule
    // ─────────────────────────────────────────

    ouvrirVehicule(veh) {
        this.action.doAction({
            type   : "ir.actions.client",
            tag    : "dashboard_analytics.action_vehicule_detail_dashboard",
            name   : `Véhicule ${veh.matricule} (${veh.numero})`,
            target : "current",
            params : {
                vehicule_id : veh.id,
                matricule   : veh.matricule,
                numero      : veh.numero,
            },
        });
    }

    // ─────────────────────────────────────────
    //  Graphique — Balance par véhicule
    // ─────────────────────────────────────────

    _renderChartBalance() {
        const canvas = document.getElementById("vd-chart-balance");
        if (!canvas) return;
        if (this._chartBalance) { this._chartBalance.destroy(); this._chartBalance = null; }

        const vehicules = [];
        for (const cat of this.state.categories) {
            for (const mod of cat.modeles) {
                for (const veh of mod.vehicules) {
                    vehicules.push(veh);
                }
            }
        }
        vehicules.sort((a, b) => b.balance - a.balance);

        const labels = vehicules.map(v => v.numero);
        const data   = vehicules.map(v => Math.round(v.balance));
        const colors = data.map(v => v >= 0 ? "rgba(22,163,74,0.8)" : "rgba(220,38,38,0.8)");

        const draw = () => {
            this._chartBalance = new Chart(canvas, {
                type: "bar",
                data: {
                    labels,
                    datasets: [{
                        label           : "Balance (DA)",
                        data,
                        backgroundColor : colors,
                        borderRadius    : 6,
                        borderSkipped   : false,
                    }],
                },
                options: {
                    responsive : true,
                    maintainAspectRatio : true,
                    plugins: {
                        legend : { display: false },
                        tooltip: {
                            callbacks: {
                                label: ctx => ` ${this.fmt(ctx.parsed.y)} DA`,
                            },
                        },
                    },
                    scales: {
                        x: {
                            grid : { display: false },
                            ticks: { font: { weight: "600" }, autoSkip: true, maxRotation: 60, minRotation: 0 },
                        },
                        y: {
                            grid : { color: "rgba(0,0,0,.06)" },
                            ticks: { font: { weight: "600" } },
                            title: { display: true, text: "Balance (DA)" },
                        },
                    },
                },
            });
        };

        if (window.Chart) { draw(); }
        else {
            const s = document.createElement("script");
            s.src   = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
            s.onload = draw;
            document.head.appendChild(s);
        }
    }

    // ─────────────────────────────────────────
    //  Handlers
    // ─────────────────────────────────────────

    onDateDebutChange(ev) { this.state.date_debut = ev.target.value; }
    onDateFinChange(ev)   { this.state.date_fin   = ev.target.value; }

    updateSelectedZone(ev) {
        this.state.selected_zone = ev.target.value;
        this.loadData();
    }

    async appliquerFiltre() { await this.loadData(); }

    async reinitialiserMois() {
        const { debut, fin }     = this._getDebutFinMois();
        this.state.date_debut    = this._toInputDate(debut);
        this.state.date_fin      = this._toInputDate(fin);
        this.state.selected_zone = "";
        await this.loadData();
    }

    retourDashboard() {
        this.action.doAction("dashboard_analytics.action_dashboard_statistiques");
    }

    get labelPeriode() {
        if (!this.state.date_debut || !this.state.date_fin) return "";
        const fmt = (str) => { const [y,m,d] = str.split("-"); return `${d}/${m}/${y}`; };
        return `${fmt(this.state.date_debut)} → ${fmt(this.state.date_fin)}`;
    }

    // ── Expand / collapse ──

    toggleCategorie(cat_id) {
        this.state.expanded_cats[cat_id] = !this.state.expanded_cats[cat_id];
    }
    isCategorieExpanded(cat_id) {
        return !!this.state.expanded_cats[cat_id];
    }

    toggleModele(cat_id, mod_name) {
        const key = `${cat_id}_${mod_name}`;
        this.state.expanded_mods[key] = !this.state.expanded_mods[key];
    }
    isModeleExpanded(cat_id, mod_name) {
        return !!this.state.expanded_mods[`${cat_id}_${mod_name}`];
    }

    // ── Formatage ──

    fmt(n) {
        const abs = Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
        return n < 0 ? `- ${abs}` : abs;
    }

    isPositive(n) { return n >= 0; }

    get totalValeurFormatted()   { return this.fmt(this.state.total_valeur); }
    get totalRevenuFormatted()   { return this.fmt(this.state.total_revenu); }
    get totalDepenseFormatted()  { return this.fmt(this.state.total_depense); }
    get totalBalanceFormatted()  { return this.fmt(this.state.total_balance); }

    get valeurMoyenneFormatted() {
        const moy = this.state.total_count > 0 ? this.state.total_valeur / this.state.total_count : 0;
        return this.fmt(moy);
    }
}

VehiculeDashboard.template = "dashboard_analytics.VehiculeDashboard";

registry
    .category("actions")
    .add("dashboard_analytics.action_vehicule_dashboard", VehiculeDashboard);


// ═══════════════════════════════════════════════════════════════════════════
//  COMPOSANT : VehiculeDetailDashboard
//  Historique mensuel Revenu / Dépense / Balance d'un véhicule,
//  depuis sa date de mise en service jusqu'au mois courant.
// ═══════════════════════════════════════════════════════════════════════════

export class VehiculeDetailDashboard extends Component {

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        const params = this.props.action?.params || {};

        this.state = useState({
            loading          : true,
            vehicule_id      : params.vehicule_id || null,
            matricule        : params.matricule   || "",
            numero           : params.numero      || "",
            prix_achat       : 0,
            valeur_actuel    : 0,
            date_service_str : "",
            rows             : [],   // [{ key, label, revenu, depense, balance }]
            total_revenu     : 0,
            total_depense    : 0,
            total_balance    : 0,
        });

        onWillStart(() => this.loadData());
    }

    _DATE_PIVOT = new Date(2025, 10, 1, 0, 0, 0);   // pivot is_old
    _TAUX_PIVOT = new Date(2026, 0, 1, 0, 0, 0);    // 260 avant 2026, 270 après

    // Parse "YYYY-MM-DD" ou "YYYY-MM-DD HH:MM:SS" venant de l'ORM
    _parseServerDate(str) {
        if (!str) return null;
        const [datePart, timePart] = str.split(" ");
        const [y, m, d] = datePart.split("-").map(Number);
        if (timePart) {
            const [hh, mm, ss] = timePart.split(":").map(Number);
            return new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0);
        }
        return new Date(y, m - 1, d);
    }

    _tauxFor(d) { return d < this._TAUX_PIVOT ? 260 : 270; }

    async loadData() {
        const vehId = this.state.vehicule_id;
        if (!vehId) { this.state.loading = false; return; }
        this.state.loading = true;
        try {
            const [vehData, recsAvec, recsSans, depenses, refunds] = await Promise.all([
                // Fiche du véhicule : prix d'achat, valeur actuelle, mise en service
                this.orm.searchRead("vehicule",
                    [["id", "=", vehId]],
                    ["id", "prix_achat", "valeur_actuel", "date_debut_service"], { limit: 1 }),
                // Paiements avec date d'encaissement
                this.orm.searchRead("revenue.record",
                    [["vehicule", "=", vehId], ["date_encaissement", "!=", false]],
                    ["id", "montant", "montant_dzd", "is_old", "date_encaissement"], { limit: 0 }),
                // Paiements sans date → rattachés au create_date de la réservation
                this.orm.searchRead("revenue.record",
                    [["vehicule", "=", vehId], ["date_encaissement", "=", false]],
                    ["id", "montant", "montant_dzd", "is_old", "reservation"], { limit: 0 }),
                // Dépenses validées du véhicule
                this.orm.searchRead("depense.record",
                    [["vehicule_numero", "=", vehId], ["status", "=", "valide"]],
                    ["id", "montant_da", "date_de_realisation"], { limit: 0 }),
                // Remboursements effectués liés aux réservations de ce véhicule
                this.orm.searchRead("refund.table",
                    [["reservation.vehicule", "=", vehId], ["status", "=", "effectuer"]],
                    ["id", "amount", "date"], { limit: 0 }),
            ]);

            // ── Fiche véhicule ──
            const veh         = vehData[0] || {};
            const serviceDate = this._parseServerDate(veh.date_debut_service);

            this.state.prix_achat    = veh.prix_achat    || 0;
            this.state.valeur_actuel = veh.valeur_actuel || 0;
            this.state.date_service_str = serviceDate
                ? `${String(serviceDate.getDate()).padStart(2,"0")}/${String(serviceDate.getMonth()+1).padStart(2,"0")}/${serviceDate.getFullYear()}`
                : "";

            // create_date des réservations pour les paiements sans date
            const resIds = [...new Set(
                recsSans.map(r => Array.isArray(r.reservation) ? r.reservation[0] : r.reservation).filter(Boolean)
            )];
            let resvDateMap = {};
            if (resIds.length > 0) {
                const resvData = await this.orm.searchRead(
                    "reservation", [["id", "in", resIds]], ["id", "create_date"], { limit: 0 }
                );
                for (const rv of resvData) resvDateMap[rv.id] = rv.create_date;
            }

            // ── Agrégation par mois ──
            const monthMap = {};   // "2025-01" → { revenu, depense }
            const touch = (key) => monthMap[key] || (monthMap[key] = { revenu: 0, depense: 0 });
            const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, "0")}`;

            const addRevenue = (rec, d) => {
                if (!d) return;
                // Cohérence is_old : avant le pivot on ne compte que les "anciens",
                // après le pivot que les "nouveaux" (même logique que la trésorerie).
                const isOldPeriod = d < this._DATE_PIVOT;
                if (isOldPeriod !== (rec.is_old === true)) return;
                const taux = this._tauxFor(d);
                touch(keyOf(d)).revenu += (rec.montant_dzd || 0) + ((rec.montant || 0) * taux);
            };

            for (const r of recsAvec) {
                addRevenue(r, this._parseServerDate(r.date_encaissement));
            }
            for (const r of recsSans) {
                const resId = Array.isArray(r.reservation) ? r.reservation[0] : r.reservation;
                addRevenue(r, resId ? this._parseServerDate(resvDateMap[resId]) : null);
            }

            for (const ref of refunds) {
                const d = this._parseServerDate(ref.date);
                if (!d) continue;
                touch(keyOf(d)).revenu -= (ref.amount || 0) * this._tauxFor(d);
            }

            for (const dep of depenses) {
                const d = this._parseServerDate(dep.date_de_realisation);
                if (!d) continue;
                touch(keyOf(d)).depense += dep.montant_da || 0;
            }

            // ── Mois de départ : la date de mise en service (même si revenu 0).
            // Si un mouvement existe avant cette date, on démarre plus tôt
            // pour ne rien perdre dans les totaux. ──
            const keys = Object.keys(monthMap).sort();

            let y0 = null, m0 = null;
            if (serviceDate) {
                y0 = serviceDate.getFullYear();
                m0 = serviceDate.getMonth() + 1;
            }
            if (keys.length > 0) {
                const [yk, mk] = keys[0].split("-").map(Number);
                if (y0 === null || yk < y0 || (yk === y0 && mk < m0)) { y0 = yk; m0 = mk; }
            }

            const rows = [];
            let total_revenu = 0, total_depense = 0;

            if (y0 !== null) {
                const now  = new Date();
                let endY = now.getFullYear(), endM = now.getMonth() + 1;
                if (keys.length > 0) {
                    const [yl, ml] = keys[keys.length - 1].split("-").map(Number);
                    if (yl > endY || (yl === endY && ml > endM)) { endY = yl; endM = ml; }
                }

                let y = y0, m = m0;
                while (y < endY || (y === endY && m <= endM)) {
                    const key  = `${y}-${String(m).padStart(2, "0")}`;
                    const cell = monthMap[key] || { revenu: 0, depense: 0 };
                    const balance = cell.revenu - cell.depense;

                    rows.push({
                        key,
                        label   : `${MOIS_LABELS[m - 1]} ${y}`,
                        revenu  : cell.revenu,
                        depense : cell.depense,
                        balance,
                    });

                    total_revenu  += cell.revenu;
                    total_depense += cell.depense;

                    m++;
                    if (m > 12) { m = 1; y++; }
                }
            }

            this.state.rows          = rows;
            this.state.total_revenu  = total_revenu;
            this.state.total_depense = total_depense;
            this.state.total_balance = total_revenu - total_depense;

        } finally {
            this.state.loading = false;
            setTimeout(() => this._renderChart(), 50);
        }
    }

    _renderChart() {
        const canvas = document.getElementById("vdd-chart");
        if (!canvas) return;
        if (this._chart) { this._chart.destroy(); this._chart = null; }

        const labels  = this.state.rows.map(r => r.label);
        const revenus = this.state.rows.map(r => Math.round(r.revenu));
        const deps    = this.state.rows.map(r => Math.round(r.depense));

        const draw = () => {
            this._chart = new Chart(canvas, {
                type: "bar",
                data: {
                    labels,
                    datasets: [
                        { label: "Revenu (DA)",  data: revenus, backgroundColor: "rgba(22,163,74,0.75)",  borderRadius: 6, borderSkipped: false },
                        { label: "Dépense (DA)", data: deps,    backgroundColor: "rgba(220,38,38,0.75)", borderRadius: 6, borderSkipped: false },
                    ],
                },
                options: {
                    responsive: true, maintainAspectRatio: true,
                    plugins: {
                        legend  : { position: "top", labels: { font: { weight: "bold" } } },
                        tooltip : { callbacks: { label: ctx => ` ${ctx.dataset.label} : ${this.fmt(ctx.parsed.y)} DA` } },
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { font: { weight: "600" }, autoSkip: true, maxRotation: 60 } },
                        y: { beginAtZero: true, grid: { color: "rgba(0,0,0,.06)" }, ticks: { font: { weight: "600" } } },
                    },
                },
            });
        };

        if (window.Chart) { draw(); }
        else {
            const s = document.createElement("script");
            s.src   = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
            s.onload = draw;
            document.head.appendChild(s);
        }
    }

    retour() {
        this.action.doAction("dashboard_analytics.action_vehicule_dashboard");
    }

    fmt(n) {
        const abs = Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
        return n < 0 ? `- ${abs}` : abs;
    }

    isPositive(n) { return n >= 0; }

    get prixAchatFormatted()     { return this.fmt(this.state.prix_achat); }
    get valeurActuelleFormatted(){ return this.fmt(this.state.valeur_actuel); }
    get totalRevenuFormatted()   { return this.fmt(this.state.total_revenu); }
    get totalDepenseFormatted()  { return this.fmt(this.state.total_depense); }
    get totalBalanceFormatted()  { return this.fmt(this.state.total_balance); }
}

VehiculeDetailDashboard.template = "dashboard_analytics.VehiculeDetailDashboard";

registry
    .category("actions")
    .add("dashboard_analytics.action_vehicule_detail_dashboard", VehiculeDetailDashboard);