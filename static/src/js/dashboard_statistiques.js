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

    // ─── Construction du domaine ORM ─────────────────────────────────────────

    _buildDomain() {
        const debut  = this._parseDebut(this.state.date_debut);
        const fin    = this._parseFin(this.state.date_fin);

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

    // ─── Chargement des données (version unique et optimisée) ─────────────────
    //
    //  On utilise readGroup avec les 2 agrégats en un seul appel réseau,
    //  ce qui évite de charger tous les enregistrements un par un (searchRead).
    //  searchCount est fusionné : readGroup renvoie __count dans le groupe.

    async loadData() {
        if (!this.state.date_debut || !this.state.date_fin) return;

        this.state.loading = true;
        try {
            const domain  = this._buildDomain();

            // Un seul appel réseau : count + sommes en même temps
            const result = await this.orm.readGroup(
                "reservation",
                domain,
                ["total_reduit_euro:sum", "montant_paye:sum"],
                []          // pas de groupBy → un seul groupe global
            );

            const row = result[0] ?? {};

            this.state.reservations_confirmer = row.__count            ?? 0;
            this.state.total_reduit_euro      = row.total_reduit_euro  ?? 0;
            this.state.total_montant_paye     = row.montant_paye       ?? 0;

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
}

DashboardStatistiques.template = "dashboard_analytics.DashboardStatistiques";

registry
    .category("actions")
    .add("dashboard_analytics.action_dashboard_statistiques", DashboardStatistiques);