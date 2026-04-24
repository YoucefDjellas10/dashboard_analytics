/** @odoo-module **/

import { registry }    from "@web/core/registry";
import { useService }  from "@web/core/utils/hooks";
import { Component, onWillStart, useState } from "@odoo/owl";

export class DashboardStatistiques extends Component {

    // ─── Setup ────────────────────────────────────────────────────────────────

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        const { debut, fin } = this._getDebutFinMois();

        this.state = useState({
            reservations_confirmer : 0,
            total_reduit_euro      : 0,
            total_montant_paye     : 0,
            panier_moyen           : 0,
            total_depense_eur      : 0,
            date_debut             : this._toInputDate(debut),
            date_fin               : this._toInputDate(fin),
            loading                : false,
            zones                  : [],
            selected_zone          : "",
        });

        onWillStart(() => this._loadZones().then(() => this.loadData()));
    }

    // ─── Chargement des zones ─────────────────────────────────────────────────

    async _loadZones() {
        this.state.zones = await this.orm.searchRead(
            "zone",
            [],
            ["id", "name"],
            { order: "name asc" }
        );
    }

    // ─── Utilitaires dates ────────────────────────────────────────────────────

    _pad(n) {
        return String(n).padStart(2, "0");
    }

    _formatORM(d) {
        return `${d.getFullYear()}-${this._pad(d.getMonth() + 1)}-${this._pad(d.getDate())} `
             + `${this._pad(d.getHours())}:${this._pad(d.getMinutes())}:${this._pad(d.getSeconds())}`;
    }

    _toInputDate(d) {
        return `${d.getFullYear()}-${this._pad(d.getMonth() + 1)}-${this._pad(d.getDate())}`;
    }

    _parseDebut(str) {
        const [y, m, d] = str.split("-").map(Number);
        return new Date(y, m - 1, d, 0, 0, 0);
    }

    _parseFin(str) {
        const [y, m, d] = str.split("-").map(Number);
        return new Date(y, m - 1, d, 23, 59, 59);
    }

    _getDebutFinMois() {
        const now = new Date();
        return {
            debut : new Date(now.getFullYear(), now.getMonth(),     1,  0,  0,  0),
            fin   : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
        };
    }

    // ─── Construction des domaines ORM ───────────────────────────────────────

    _buildDomain() {
        const debut = this._parseDebut(this.state.date_debut);
        const fin   = this._parseFin(this.state.date_fin);

        const domain = [
            ["status",      "=",  "confirmee"],
            ["create_date", ">=", this._formatORM(debut)],
            ["create_date", "<=", this._formatORM(fin)],
        ];

        if (this.state.selected_zone) {
            domain.push(["zone", "=", parseInt(this.state.selected_zone)]);
        }

        return domain;
    }

    // Dépenses : status=valide + date_de_realisation dans la période + zone
    _buildDomainDepense() {
        const domain = [
            ["status",              "=",  "valide"],
            ["date_de_realisation", ">=", this.state.date_debut],
            ["date_de_realisation", "<=", this.state.date_fin],
        ];

        if (this.state.selected_zone) {
            domain.push(["zone", "=", parseInt(this.state.selected_zone)]);
        }

        return domain;
    }

    // ─── Chargement des données ───────────────────────────────────────────────
    //
    //  • Réservations  : readGroup (1 appel, agréga SQL)
    //  • Dépenses      : readGroup sur montant_da (stocké) + taux de change récupéré 1 fois
    //    Si montant_eur devient store=True dans le Python, on peut switcher directement
    //    sur ["montant_eur:sum"] sans toucher au reste.

    async loadData() {
        if (!this.state.date_debut || !this.state.date_fin) return;

        this.state.loading = true;
        try {
            const [resResult, depResult, tauxResult] = await Promise.all([

                // ── Réservations ──────────────────────────────────────────────
                this.orm.readGroup(
                    "reservation",
                    this._buildDomain(),
                    ["total_reduit_euro:sum", "montant_paye:sum"],
                    []
                ),

                // ── Dépenses : somme montant_da (champ stocké) ────────────────
                // montant_eur est compute sans store=True → non agrégeable en SQL
                // Solution : sommer montant_da puis diviser par le taux de change
                this.orm.readGroup(
                    "depense.record",
                    this._buildDomainDepense(),
                    ["montant_da:sum"],
                    []
                ),

                // ── Taux de change (id=2) ─────────────────────────────────────
                this.orm.searchRead(
                    "taux.change",
                    [["id", "=", 2]],
                    ["montant"],
                    { limit: 1 }
                ),

            ]);

            // ── Réservations ──────────────────────────────────────────────────
            const rowRes = resResult[0] ?? {};
            const count  = rowRes.__count           ?? 0;
            const ca     = rowRes.total_reduit_euro ?? 0;

            this.state.reservations_confirmer = count;
            this.state.total_reduit_euro      = ca;
            this.state.total_montant_paye     = rowRes.montant_paye ?? 0;
            this.state.panier_moyen           = count > 0 ? ca / count : 0;

            // ── Dépenses ──────────────────────────────────────────────────────
            const rowDep  = depResult[0]  ?? {};
            const totalDa = rowDep.montant_da ?? 0;
            const taux    = tauxResult[0]?.montant ?? 1;   // évite division par 0

            this.state.total_depense_eur = taux > 0 ? totalDa / taux : 0;

        } finally {
            this.state.loading = false;
        }
    }

    // ─── Gestionnaires d'événements ───────────────────────────────────────────

    onDateDebutChange(ev) {
        this.state.date_debut = ev.target.value;
    }

    onDateFinChange(ev) {
        this.state.date_fin = ev.target.value;
    }

    updateSelectedZone(ev) {
        this.state.selected_zone = ev.target.value;
    }

    async appliquerFiltre() {
        await this.loadData();
    }

    async reinitialiserMois() {
        const { debut, fin }     = this._getDebutFinMois();
        this.state.date_debut    = this._toInputDate(debut);
        this.state.date_fin      = this._toInputDate(fin);
        this.state.selected_zone = "";
        await this.loadData();
    }

    // ─── Label période affichée ───────────────────────────────────────────────

    get labelPeriode() {
        if (!this.state.date_debut || !this.state.date_fin) return "";
        const fmt = (str) => {
            const [y, m, d] = str.split("-");
            return `${d}/${m}/${y}`;
        };
        return `${fmt(this.state.date_debut)} → ${fmt(this.state.date_fin)}`;
    }

    // ─── Balance ─────────────────────────────────────────────────────────────

    // Balance = Trésorerie - Dépenses (getter réactif, pas besoin de state)
    get balance() {
        return this.state.total_montant_paye - this.state.total_depense_eur;
    }

    // ─── Ouverture des vues liste ─────────────────────────────────────────────

    ouvrirReservations() {
        this.action.doAction({
            type      : "ir.actions.act_window",
            name      : `Réservations Confirmées — ${this.labelPeriode}`,
            res_model : "reservation",
            view_mode : "list,form",
            domain    : this._buildDomain(),
        });
    }

    ouvrirChiffreAffaire() {
        this.action.doAction({
            type      : "ir.actions.act_window",
            name      : `Chiffre d'affaires — ${this.labelPeriode}`,
            res_model : "reservation",
            view_mode : "list,form",
            domain    : this._buildDomain(),
        });
    }

    ouvrirTresorerie() {
        this.action.doAction({
            type      : "ir.actions.act_window",
            name      : `Trésorerie — ${this.labelPeriode}`,
            res_model : "reservation",
            view_mode : "list,form",
            domain    : this._buildDomain(),
        });
    }

    ouvrirDepenses() {
        this.action.doAction({
            type      : "ir.actions.act_window",
            name      : `Dépenses Validées — ${this.labelPeriode}`,
            res_model : "depense.record",
            view_mode : "list,form",
            domain    : this._buildDomainDepense(),
        });
    }
}

DashboardStatistiques.template = "dashboard_analytics.DashboardStatistiques";

registry
    .category("actions")
    .add("dashboard_analytics.action_dashboard_statistiques", DashboardStatistiques);