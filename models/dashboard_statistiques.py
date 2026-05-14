from odoo import models, fields, api
from datetime import datetime, timedelta
import logging

_logger = logging.getLogger(__name__)


class DashboardStatistiques(models.Model):
    _name = 'dashboard.statistiques'
    _description = 'Dashboard Statistiques'

    name = fields.Char(string='Nom', required=True)
    date = fields.Date(string='Date', default=fields.Date.today)
    total_ventes = fields.Float(string='Total Ventes')
    total_clients = fields.Integer(string='Total Clients')
    total_commandes = fields.Integer(string='Total Commandes')

    @api.model
    def get_tresorerie_mois_v2(self, annee, mois, zone_id=None):
        """
        Appelle action_search_revenues() — exactement la même méthode
        que la page Finance — et retourne :
            tresorerie = total_montant_dzd + (total_montant_eur × taux)

        Taux identique à balance.py :
            260 si annee < 2026
            270 si annee >= 2026

        Exemple : 185 783 + (38 087,5 × 270) = 10 469 408 DA ✅
        """
        debut  = datetime(annee, mois, 1)
        fin_dt = datetime(annee + 1, 1, 1) if mois == 12 else datetime(annee, mois + 1, 1)

        du_str = debut.strftime('%Y-%m-%d')
        au_str = (fin_dt - timedelta(seconds=1)).strftime('%Y-%m-%d')

        filters = {'du': du_str, 'au': au_str}
        if zone_id:
            filters['zone'] = int(zone_id)

        result = self.env['revenue.record'].action_search_revenues(
            filters=filters,
            page=1,
            limit=999999,
        )

        dzd  = result.get('total_montant_dzd', 0)
        eur  = result.get('total_montant_eur', 0)  # déjà net des remboursements €

        # Même taux que balance.py : 260 avant 2026, 270 à partir de 2026
        taux = 260 if annee < 2026 else 270

        # 185 783 + (38 087,5 × 270) = 10 469 408 DA
        tresorerie = dzd + (eur * taux)

        return {
            'tresorerie'       : tresorerie,
            'total_montant_dzd': dzd,
            'total_montant_eur': eur,
            'taux'             : taux,
        }

    @api.model
    def get_tresorerie_par_zone_v2(self, annee):
        """
        Trésorerie annuelle par zone — pour les pie charts.
        """
        zones  = self.env['zone'].search([], order='name asc')
        result = []
        for zone in zones:
            total = sum(
                self.get_tresorerie_mois_v2(annee, mois, zone_id=zone.id)['tresorerie']
                for mois in range(1, 13)
            )
            if total > 0:
                result.append({'zone_name': zone.name, 'tresorerie': total})
        return result