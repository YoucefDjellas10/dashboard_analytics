/** @odoo-module **/

import { registry }    from "@web/core/registry";
import { useService }  from "@web/core/utils/hooks";
import { Component, onWillStart, useState } from "@odoo/owl";

export class DashboardStatistiques extends Component {

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        const { debut, fin } = this._getDebutFinMois();

        this.state = useState({
            reservations_confirmer : 0,
            total_ca_da            : 0,
            total_tresorerie_da    : 0,
            panier_moyen_da        : 0,
            total_depense_da       : 0,
            taux_remplissage       : 0,
            date_debut             : this._toInputDate(debut),
            date_fin               : this._toInputDate(fin),
            loading                : false,
            zones                  : [],
            selected_zone          : "",
        });

        onWillStart(() => this._loadZones().then(() => this.loadData()));
    }

    async _loadZones() {
        this.state.zones = await this.orm.searchRead(
            "zone",
            [],
            ["id", "name"],
            { order: "name asc" }
        );
    }

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

    _nbJours(debut, fin) {
        const ms = fin - debut;
        return Math.round(ms / (1000 * 60 * 60 * 24));
    }

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

    _buildDomainDates() {
        const debut = this._parseDebut(this.state.date_debut);
        const fin   = this._parseFin(this.state.date_fin);

        const domain = [
            ["status",           "=",  "confirmee"],
            ["date_heure_debut", "<=", this._formatORM(fin)],
            ["date_heure_fin",   ">=", this._formatORM(debut)],
        ];

        if (this.state.selected_zone) {
            domain.push(["zone", "=", parseInt(this.state.selected_zone)]);
        }

        return domain;
    }

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

    async loadData() {
        if (!this.state.date_debut || !this.state.date_fin) return;

        this.state.loading = true;
        try {
            const [
                resResult,
                depResult,
                tauxResult,
                vehiculesResult,
                resDatesList,
            ] = await Promise.all([

                this.orm.readGroup(
                    "reservation",
                    this._buildDomain(),
                    ["total_reduit_euro:sum", "montant_paye:sum"],
                    []
                ),

                this.orm.readGroup(
                    "depense.record",
                    this._buildDomainDepense(),
                    ["montant_da:sum"],
                    []
                ),

                this.orm.searchRead(
                    "taux.change",
                    [["id", "=", 2]],
                    ["montant"],
                    { limit: 1 }
                ),

                this.orm.searchRead(
                    "vehicule",
                    this.state.selected_zone
                        ? [["zone", "=", parseInt(this.state.selected_zone)], ["active_test", "=", true]]
                        : [["active_test", "=", true]],
                    ["id"],
                ),

                this.orm.searchRead(
                    "reservation",
                    this._buildDomainDates(),
                    ["date_heure_debut", "date_heure_fin"],
                ),

            ]);

            const rowRes  = resResult[0] ?? {};
            const count   = rowRes.__count            ?? 0;
            const caEuro  = rowRes.total_reduit_euro  ?? 0;
            const payeEuro = rowRes.montant_paye      ?? 0;

            const taux = tauxResult[0]?.montant ?? 1;

            this.state.total_ca_da         = caEuro   * taux;
            this.state.total_tresorerie_da = payeEuro * taux;
            this.state.panier_moyen_da     = count > 0 ? (caEuro / count) * taux : 0;
            this.state.reservations_confirmer = count;

            const rowDep = depResult[0] ?? {};
            this.state.total_depense_da = rowDep.montant_da ?? 0;

            // ───── TAUX DE REMPLISSAGE ─────
            const debut          = this._parseDebut(this.state.date_debut);
            const fin            = this._parseFin(this.state.date_fin);
            const nbJoursPeriode = this._nbJours(debut, fin);
            const nbVehicules    = vehiculesResult.length;

            if (nbVehicules > 0 && nbJoursPeriode > 0) {
                let totalJoursReserves = 0;

                for (const r of resDatesList) {
                    const deb = new Date(r.date_heure_debut);
                    const fn  = new Date(r.date_heure_fin);

                    const startIntersect = deb < debut ? debut : deb;
                    const endIntersect   = fn  > fin   ? fin   : fn;

                    const jours = Math.ceil(
                        (endIntersect - startIntersect) / (1000 * 60 * 60 * 24)
                    );

                    if (jours > 0) {
                        totalJoursReserves += jours;
                    }
                }

                const capaciteTotale = nbVehicules * nbJoursPeriode;
                const tauxCalc = (totalJoursReserves / capaciteTotale) * 100;
                this.state.taux_remplissage = Math.min(100, Math.round(tauxCalc));

            } else {
                this.state.taux_remplissage = 0;
            }

        } finally {
            this.state.loading = false;
        }
    }

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

    get labelPeriode() {
        if (!this.state.date_debut || !this.state.date_fin) return "";
        const fmt = (str) => {
            const [y, m, d] = str.split("-");
            return `${d}/${m}/${y}`;
        };
        return `${fmt(this.state.date_debut)} → ${fmt(this.state.date_fin)}`;
    }

    get balance() {
        return this.state.total_tresorerie_da - this.state.total_depense_da;
    }

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