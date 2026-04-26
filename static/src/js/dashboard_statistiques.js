/** @odoo-module **/

import { registry }   from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Component, onWillStart, useState } from "@odoo/owl";

export class DashboardStatistiques extends Component {

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        const { debut, fin } = this._getDebutFinMois();

        this.state = useState({
            // ── Période actuelle ──
            reservations_confirmer : 0,
            total_ca_da            : 0,
            total_tresorerie_da    : 0,
            panier_moyen_da        : 0,
            total_depense_da       : 0,
            taux_remplissage       : 0,

            // ── Période N-1 ──
            prev_reservations      : null,
            prev_ca_da             : null,
            prev_tresorerie_da     : null,
            prev_panier_moyen_da   : null,
            prev_depense_da        : null,
            prev_taux_remplissage  : null,

            date_debut             : this._toInputDate(debut),
            date_fin               : this._toInputDate(fin),
            loading                : false,
            zones                  : [],
            selected_zone          : "",
        });

        onWillStart(() => this._loadZones().then(() => this.loadData()));
    }

    // ─────────────────────────────────────────
    //  Utilitaires
    // ─────────────────────────────────────────

    async _loadZones() {
        this.state.zones = await this.orm.searchRead(
            "zone", [], ["id", "name"], { order: "name asc" }
        );
    }

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

    _nbJours(debut, fin) {
        return Math.round((fin - debut) / (1000 * 60 * 60 * 24));
    }

    // ─────────────────────────────────────────
    //  Calcul de la période N-1
    //  → même mois, même durée, mais -1 an
    // ─────────────────────────────────────────

    _getPrevPeriod(dateDebutStr, dateFinStr) {
        const debut = this._parseDebut(dateDebutStr);
        const fin   = this._parseFin(dateFinStr);

        // On garde mois et jour, on recule l'année de 1
        const prevDebut = new Date(debut.getFullYear()-1, debut.getMonth(), debut.getDate(),  0,  0,  0);
        const prevFin   = new Date(fin.getFullYear()-1,   fin.getMonth(),   fin.getDate(),   23, 59, 59);

        return {
            debutStr : this._toInputDate(prevDebut),
            finStr   : this._toInputDate(prevFin),
            debut    : prevDebut,
            fin      : prevFin,
        };
    }

    // ─────────────────────────────────────────
    //  Domaines
    // ─────────────────────────────────────────

    _buildDomain(debutStr, finStr) {
        const debut = this._parseDebut(debutStr);
        const fin   = this._parseFin(finStr);
        const domain = [
            ["status",      "=",  "confirmee"],
            ["create_date", ">=", this._formatORM(debut)],
            ["create_date", "<=", this._formatORM(fin)],
        ];
        if (this.state.selected_zone)
            domain.push(["zone", "=", parseInt(this.state.selected_zone)]);
        return domain;
    }

    _buildDomainDates(debutStr, finStr) {
        const debut = this._parseDebut(debutStr);
        const fin   = this._parseFin(finStr);
        const domain = [
            ["status",           "=",  "confirmee"],
            ["date_heure_debut", "<=", this._formatORM(fin)],
            ["date_heure_fin",   ">=", this._formatORM(debut)],
        ];
        if (this.state.selected_zone)
            domain.push(["zone", "=", parseInt(this.state.selected_zone)]);
        return domain;
    }

    _buildDomainDepense(debutStr, finStr) {
        const domain = [
            ["status",              "=",  "valide"],
            ["date_de_realisation", ">=", debutStr],
            ["date_de_realisation", "<=", finStr],
        ];
        if (this.state.selected_zone)
            domain.push(["zone", "=", parseInt(this.state.selected_zone)]);
        return domain;
    }

    // ─────────────────────────────────────────
    //  Chargement des données pour UNE période
    // ─────────────────────────────────────────

    async _fetchPeriod(debutStr, finStr) {
        const debut = this._parseDebut(debutStr);
        const fin   = this._parseFin(finStr);

        const [resResult, depResult, tauxResult, vehiculesResult, resDatesList] =
            await Promise.all([

                this.orm.readGroup("reservation",
                    this._buildDomain(debutStr, finStr),
                    ["total_reduit_euro:sum", "montant_paye:sum"], []
                ),

                this.orm.readGroup("depense.record",
                    this._buildDomainDepense(debutStr, finStr),
                    ["montant_da:sum"], []
                ),

                this.orm.searchRead("taux.change",
                    [["id", "=", 2]], ["montant"], { limit: 1 }
                ),

                this.orm.searchRead("vehicule",
                    this.state.selected_zone
                        ? [["zone", "=", parseInt(this.state.selected_zone)], ["active_test", "=", true]]
                        : [["active_test", "=", true]],
                    ["id"]
                ),

                this.orm.searchRead("reservation",
                    this._buildDomainDates(debutStr, finStr),
                    ["date_heure_debut", "date_heure_fin"]
                ),
            ]);

        const rowRes   = resResult[0] ?? {};
        const count    = rowRes.__count           ?? 0;
        const caEuro   = rowRes.total_reduit_euro ?? 0;
        const payeEuro = rowRes.montant_paye      ?? 0;
        const taux     = tauxResult[0]?.montant   ?? 1;

        const ca_da         = caEuro   * taux;
        const tresorerie_da = payeEuro * taux;
        const panier_da     = count > 0 ? (caEuro / count) * taux : 0;
        const depense_da    = (depResult[0] ?? {}).montant_da ?? 0;

        // Taux de remplissage
        const nbJoursPeriode = this._nbJours(debut, fin);
        const nbVehicules    = vehiculesResult.length;
        let taux_remplissage = 0;

        if (nbVehicules > 0 && nbJoursPeriode > 0) {
            let totalJoursReserves = 0;
            for (const r of resDatesList) {
                const deb = new Date(r.date_heure_debut);
                const fn  = new Date(r.date_heure_fin);
                const startIntersect = deb < debut ? debut : deb;
                const endIntersect   = fn  > fin   ? fin   : fn;
                const jours = Math.ceil((endIntersect - startIntersect) / (1000*60*60*24));
                if (jours > 0) totalJoursReserves += jours;
            }
            const tauxCalc = (totalJoursReserves / (nbVehicules * nbJoursPeriode)) * 100;
            taux_remplissage = Math.min(100, Math.round(tauxCalc));
        }

        return { count, ca_da, tresorerie_da, panier_da, depense_da, taux_remplissage };
    }

    // ─────────────────────────────────────────
    //  loadData : charge N et N-1 en parallèle
    // ─────────────────────────────────────────

    async loadData() {
        if (!this.state.date_debut || !this.state.date_fin) return;
        this.state.loading = true;
        try {
            const prev = this._getPrevPeriod(this.state.date_debut, this.state.date_fin);

            const [cur, prv] = await Promise.all([
                this._fetchPeriod(this.state.date_debut, this.state.date_fin),
                this._fetchPeriod(prev.debutStr, prev.finStr),
            ]);

            // Période actuelle
            this.state.reservations_confirmer = cur.count;
            this.state.total_ca_da            = cur.ca_da;
            this.state.total_tresorerie_da    = cur.tresorerie_da;
            this.state.panier_moyen_da        = cur.panier_da;
            this.state.total_depense_da       = cur.depense_da;
            this.state.taux_remplissage       = cur.taux_remplissage;

            // Période N-1
            this.state.prev_reservations     = prv.count;
            this.state.prev_ca_da            = prv.ca_da;
            this.state.prev_tresorerie_da    = prv.tresorerie_da;
            this.state.prev_panier_moyen_da  = prv.panier_da;
            this.state.prev_depense_da       = prv.depense_da;
            this.state.prev_taux_remplissage = prv.taux_remplissage;

        } finally {
            this.state.loading = false;
        }
    }

    // ─────────────────────────────────────────
    //  Handlers
    // ─────────────────────────────────────────

    onDateDebutChange(ev) { this.state.date_debut = ev.target.value; }
    onDateFinChange(ev)   { this.state.date_fin   = ev.target.value; }

    updateSelectedZone(ev) { this.state.selected_zone = ev.target.value; }

    async appliquerFiltre()  { await this.loadData(); }

    async reinitialiserMois() {
        const { debut, fin }     = this._getDebutFinMois();
        this.state.date_debut    = this._toInputDate(debut);
        this.state.date_fin      = this._toInputDate(fin);
        this.state.selected_zone = "";
        await this.loadData();
    }

    get labelPeriode() {
        if (!this.state.date_debut || !this.state.date_fin) return "";
        const fmt = (str) => { const [y,m,d] = str.split("-"); return `${d}/${m}/${y}`; };
        return `${fmt(this.state.date_debut)} → ${fmt(this.state.date_fin)}`;
    }

    get balance() {
        return this.state.total_tresorerie_da - this.state.total_depense_da;
    }

    get prevBalance() {
        if (this.state.prev_tresorerie_da === null) return null;
        return this.state.prev_tresorerie_da - this.state.prev_depense_da;
    }

    // ─────────────────────────────────────────
    //  Helpers delta (pour le template)
    // ─────────────────────────────────────────

    /**
     * Retourne { val, positive } ou null si pas de données N-1
     * val : valeur arrondie (avec signe)
     * positive : true si hausse, false si baisse
     */
    _delta(current, prev) {
        if (prev === null || prev === undefined) return null;
        const d = Math.round(current - prev);
        return { val: d, positive: d >= 0 };
    }

    get deltaReservations()  { return this._delta(this.state.reservations_confirmer, this.state.prev_reservations); }
    get deltaCa()            { return this._delta(this.state.total_ca_da,            this.state.prev_ca_da); }
    get deltaTresorerie()    { return this._delta(this.state.total_tresorerie_da,    this.state.prev_tresorerie_da); }
    get deltaPanier()        { return this._delta(this.state.panier_moyen_da,        this.state.prev_panier_moyen_da); }
    get deltaDepense()       { return this._delta(this.state.total_depense_da,       this.state.prev_depense_da); }
    get deltaTaux()          { return this._delta(this.state.taux_remplissage,       this.state.prev_taux_remplissage); }
    get deltaBalance()       { return this._delta(this.balance,                      this.prevBalance); }

    // ─────────────────────────────────────────
    //  Actions
    // ─────────────────────────────────────────

    ouvrirReservations() {
        this.action.doAction({
            type: "ir.actions.act_window",
            name: `Réservations Confirmées — ${this.labelPeriode}`,
            res_model: "reservation", view_mode: "list,form",
            domain: this._buildDomain(this.state.date_debut, this.state.date_fin),
        });
    }

    ouvrirChiffreAffaire() {
        this.action.doAction({
            type: "ir.actions.act_window",
            name: `Chiffre d'affaires — ${this.labelPeriode}`,
            res_model: "reservation", view_mode: "list,form",
            domain: this._buildDomain(this.state.date_debut, this.state.date_fin),
        });
    }

    ouvrirDepenses() {
        this.action.doAction({
            type: "ir.actions.act_window",
            name: `Dépenses Validées — ${this.labelPeriode}`,
            res_model: "depense.record", view_mode: "list,form",
            domain: this._buildDomainDepense(this.state.date_debut, this.state.date_fin),
        });
    }
}

DashboardStatistiques.template = "dashboard_analytics.DashboardStatistiques";

registry
    .category("actions")
    .add("dashboard_analytics.action_dashboard_statistiques", DashboardStatistiques);