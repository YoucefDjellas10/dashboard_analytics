/** @odoo-module **/

import { registry }   from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Component, onWillStart, useState } from "@odoo/owl";

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

            categories      : [],   // [{ id, name, total_valeur, total_revenu, total_depense, total_balance, modeles: [...] }]
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

    // Pivot du flag is_old (revenue.record "ancien" vs "nouveau") — sert uniquement
    // à choisir le bon domaine de recherche, plus au calcul du taux (voir plus bas).
    _DATE_PIVOT = new Date(2025, 10, 1, 0, 0, 0);

    // ── Remboursements : refund.table n'a pas (à confirmer) de champ DA déjà
    // stocké comme montant_eur_dzd sur revenue.record. On garde donc ici une
    // segmentation par taux/date en attendant confirmation du modèle refund.table.
    _TAUX_PIVOT = new Date(2026, 0, 1, 0, 0, 0);

    _buildRefundSegments(debut, fin) {
        const segments  = [];
        const pivotTaux = this._TAUX_PIVOT;

        if (debut < pivotTaux) {
            const segEnd = fin < pivotTaux ? fin : new Date(pivotTaux - 1);
            segments.push({ start: debut, end: segEnd, taux: 260 });
        }
        if (fin >= pivotTaux) {
            const segStart = debut >= pivotTaux ? debut : pivotTaux;
            segments.push({ start: segStart, end: fin, taux: 270 });
        }
        return segments;
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

            // ── Domaines Revenue : split old/new uniquement (le taux est déjà
            // intégré dans le champ stocké montant_eur_dzd, pas besoin de le
            // recalculer nous-mêmes) ──
            const revenuePromises = [];

            if (debut < this._DATE_PIVOT) {
                const finOld = fin < this._DATE_PIVOT ? fin : new Date(this._DATE_PIVOT - 1);
                revenuePromises.push(
                    this.orm.searchRead("revenue.record", [
                        ...zoneFilterRevenue,
                        ["is_old", "=", true],
                        ["date_encaissement", ">=", this._formatORM(debut)],
                        ["date_encaissement", "<=", this._formatORM(finOld)],
                    ], ["id", "montant_dzd", "montant_eur_dzd", "vehicule"], { limit: 0 }),
                    this.orm.searchRead("revenue.record", [
                        ...zoneFilterRevenue,
                        ["is_old", "=", true],
                        ["date_encaissement", "=", false],
                        ["reservation.create_date", ">=", this._formatORM(debut)],
                        ["reservation.create_date", "<=", this._formatORM(finOld)],
                    ], ["id", "montant_dzd", "montant_eur_dzd", "vehicule"], { limit: 0 })
                );
            }

            if (fin >= this._DATE_PIVOT) {
                const debutNew = debut >= this._DATE_PIVOT ? debut : this._DATE_PIVOT;
                revenuePromises.push(
                    this.orm.searchRead("revenue.record", [
                        ...zoneFilterRevenue,
                        ["is_old", "!=", true],
                        ["date_encaissement", ">=", this._formatORM(debutNew)],
                        ["date_encaissement", "<=", this._formatORM(fin)],
                    ], ["id", "montant_dzd", "montant_eur_dzd", "vehicule"], { limit: 0 }),
                    this.orm.searchRead("revenue.record", [
                        ...zoneFilterRevenue,
                        ["is_old", "!=", true],
                        ["date_encaissement", "=", false],
                        ["reservation.create_date", ">=", this._formatORM(debutNew)],
                        ["reservation.create_date", "<=", this._formatORM(fin)],
                    ], ["id", "montant_dzd", "montant_eur_dzd", "vehicule"], { limit: 0 })
                );
            }

            // ── Domaine dépenses ──
            const depenseDomain = [
                ["status",              "=",  "valide"],
                ["date_de_realisation", ">=", debutStr],
                ["date_de_realisation", "<=", finVehiculeStr],
            ];
            if (zoneId) depenseDomain.push(["zone", "=", zoneId]);

            // ── Domaine remboursements, segmenté par taux (voir note ci-dessus) ──
            const refundSegments = this._buildRefundSegments(debut, fin);
            const refundPromises = refundSegments.map(seg => {
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
                // montant_eur_dzd est déjà le montant EUR converti en DA au taux
                // en vigueur au moment de la transaction (champ stocké côté Odoo).
                const montant = (r.montant_dzd || 0) + (r.montant_eur_dzd || 0);
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

            // Catégories triées par ordre alphabétique (A, B, C…) ;
            // modèles et véhicules restent triés par valeur décroissante.
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
    //  Graphique — Balance par véhicule
    // ─────────────────────────────────────────

    _renderChartBalance() {
        const canvas = document.getElementById("vd-chart-balance");
        if (!canvas) return;
        if (this._chartBalance) { this._chartBalance.destroy(); this._chartBalance = null; }

        // Liste plate de tous les véhicules, triée par balance décroissante
        const vehicules = [];
        for (const cat of this.state.categories) {
            for (const mod of cat.modeles) {
                for (const veh of mod.vehicules) {
                    vehicules.push(veh);
                }
            }
        }
        vehicules.sort((a, b) => b.balance - a.balance);

        // Uniquement le numéro du véhicule en label (pas le matricule)
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