/** @odoo-module **/

import { registry }   from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Component, onWillStart, useState } from "@odoo/owl";

export class VehiculeDashboard extends Component {

    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        this.state = useState({
            loading         : false,
            zones           : [],
            selected_zone   : "",
            categories      : [],   // [{ id, name, total_valeur, total_count, modeles: [...] }]
            total_valeur    : 0,
            total_count     : 0,
            expanded_cats   : {},
            expanded_mods   : {},
        });

        onWillStart(() => this._loadZones().then(() => this.loadData()));
    }

    async _loadZones() {
        this.state.zones = await this.orm.searchRead(
            "zone", [], ["id", "name"], { order: "name asc" }
        );
    }

    // Même logique de filtrage que dans reservation : "actif" + zone sélectionnée
    _buildDomain() {
        const domain = [["active_test", "=", true]];
        if (this.state.selected_zone)
            domain.push(["zone", "=", parseInt(this.state.selected_zone)]);
        return domain;
    }

    async loadData() {
        this.state.loading = true;
        try {
            const vehicules = await this.orm.searchRead(
                "vehicule",
                this._buildDomain(),
                ["id", "name", "matricule", "numero", "categorie", "model_name", "valeur_actuel", "zone"],
                { limit: 0 }
            );

            const catMap = {};

            for (const v of vehicules) {
                const catId   = Array.isArray(v.categorie) ? v.categorie[0] : 0;
                const catName = Array.isArray(v.categorie) ? v.categorie[1] : "Sans catégorie";
                const modName = v.model_name || "Sans modèle";
                const valeur  = v.valeur_actuel || 0;

                if (!catMap[catId]) {
                    catMap[catId] = { id: catId, name: catName, total_valeur: 0, total_count: 0, modeles: {} };
                }
                const cat = catMap[catId];

                if (!cat.modeles[modName]) {
                    cat.modeles[modName] = { name: modName, total_valeur: 0, total_count: 0, vehicules: [] };
                }
                const mod = cat.modeles[modName];

                mod.vehicules.push({
                    id        : v.id,
                    name      : v.name,
                    matricule : v.matricule,
                    numero    : v.numero,
                    valeur    : valeur,
                });
                mod.total_valeur += valeur;
                mod.total_count  += 1;

                cat.total_valeur += valeur;
                cat.total_count  += 1;
            }

            // Tri : véhicules par valeur desc dans chaque modèle,
            // modèles par valeur totale desc dans chaque catégorie,
            // catégories par valeur totale desc
            const categories = Object.values(catMap).map(cat => {
                const modeles = Object.values(cat.modeles)
                    .map(mod => {
                        mod.vehicules.sort((a, b) => b.valeur - a.valeur);
                        return mod;
                    })
                    .sort((a, b) => b.total_valeur - a.total_valeur);
                return { ...cat, modeles };
            }).sort((a, b) => b.total_valeur - a.total_valeur);

            this.state.categories   = categories;
            this.state.total_valeur = vehicules.reduce((s, v) => s + (v.valeur_actuel || 0), 0);
            this.state.total_count  = vehicules.length;

        } finally {
            this.state.loading = false;
        }
    }

    updateSelectedZone(ev) {
        this.state.selected_zone = ev.target.value;
        this.loadData();
    }

    retourDashboard() {
        this.action.doAction("dashboard_analytics.action_dashboard_statistiques");
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
        return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    }

    get totalValeurFormatted() { return this.fmt(this.state.total_valeur); }

    get valeurMoyenneFormatted() {
        const moy = this.state.total_count > 0 ? this.state.total_valeur / this.state.total_count : 0;
        return this.fmt(moy);
    }
}

VehiculeDashboard.template = "dashboard_analytics.VehiculeDashboard";

registry
    .category("actions")
    .add("dashboard_analytics.action_vehicule_dashboard", VehiculeDashboard);