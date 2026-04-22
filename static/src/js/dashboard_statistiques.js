/** @odoo-module **/

import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Component, onWillStart, useState } from "@odoo/owl";

export class DashboardStatistiques extends Component {

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");

        this.state = useState({
            reservations_confirmer: 0,
            total_reduit_euro: 0,
            mois_en_cours: "",
        });

        onWillStart(async () => {
            await this.loadData();
        });
    }

    _pad(n) {
        return String(n).padStart(2, "0");
    }

    _formatDate(d) {
        return `${d.getFullYear()}-${this._pad(d.getMonth()+1)}-${this._pad(d.getDate())} ${this._pad(d.getHours())}:${this._pad(d.getMinutes())}:${this._pad(d.getSeconds())}`;
    }

    _getDebutFinMois() {
        const now = new Date();
        return {
            debut: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0),
            fin:   new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
        };
    }

    async loadData() {
        const now = new Date();
        const mois = ["Janvier","Février","Mars","Avril","Mai","Juin",
                      "Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

        this.state.mois_en_cours = `${mois[now.getMonth()]} ${now.getFullYear()}`;

        const { debut, fin } = this._getDebutFinMois();
        const domaine = [
            ["status", "=", "confirmee"],
            ["create_date", ">=", this._formatDate(debut)],
            ["create_date", "<=", this._formatDate(fin)],
        ];

        const [count, records] = await Promise.all([
            this.orm.searchCount("reservation", domaine),
            this.orm.searchRead("reservation", domaine, ["total_reduit_euro"]),
        ]);

        this.state.reservations_confirmer = count;
        this.state.total_reduit_euro = records.reduce((acc, r) => acc + (r.total_reduit_euro || 0), 0);
    }

    ouvrirReservations() {
        const { debut, fin } = this._getDebutFinMois();

        this.action.doAction({
            type: "ir.actions.act_window",
            name: "Réservations Confirmées - Ce mois",
            res_model: "reservation",
            view_mode: "list,form",
            domain: [
                ["status", "=", "confirmee"],
                ["create_date", ">=", this._formatDate(debut)],
                ["create_date", "<=", this._formatDate(fin)],
            ],
        });
    }

    ouvrirChiffreAffaire() {
        const { debut, fin } = this._getDebutFinMois();

        this.action.doAction({
            type: "ir.actions.act_window",
            name: "Chiffre d'affaires - Ce mois",
            res_model: "reservation",
            view_mode: "list,form",
            domain: [
                ["status", "=", "confirmee"],
                ["create_date", ">=", this._formatDate(debut)],
                ["create_date", "<=", this._formatDate(fin)],
            ],
        });
    }
}

DashboardStatistiques.template = "dashboard_analytics.DashboardStatistiques";

registry
    .category("actions")
    .add("dashboard_analytics.action_dashboard_statistiques", DashboardStatistiques);