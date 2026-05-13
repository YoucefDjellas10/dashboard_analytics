from odoo import models, fields, api
from datetime import datetime
import logging

_logger = logging.getLogger(__name__)

SEUIL = datetime(2025, 11, 1, 0, 0, 0)


class DashboardStatistiques(models.Model):
    _name = 'dashboard.statistiques'
    _description = 'Dashboard Statistiques'

    name = fields.Char(string='Nom', required=True)
    date = fields.Date(string='Date', default=fields.Date.today)
    total_ventes = fields.Float(string='Total Ventes')
    total_clients = fields.Integer(string='Total Clients')
    total_commandes = fields.Integer(string='Total Commandes')

    # ──────────────────────────────────────────────────────────────
    # STRATÉGIE DÉFINITIVE
    # ──────────────────────────────────────────────────────────────
    # Le seul champ 100% fiable en domain ORM sur revenue.record
    # est create_date (champ système Odoo, toujours en base).
    #
    # TOUS les autres champs (zone, zone_autre, zone_encaissement,
    # date_encaissement, is_old, reservation.create_date, etc.)
    # sont filtrés UNIQUEMENT en Python via filtered().
    #
    # Pour la zone, on passe par les IDs de réservation (modèle
    # 'reservation' dont on contrôle les champs store=True).
    # ──────────────────────────────────────────────────────────────

    @api.model
    def get_tresorerie_mois(self, annee, mois, zone_id=None):
        """
        Trésorerie nette = (SUM montant_dzd + SUM montant * taux) - remboursements.
        """
        debut = datetime(annee, mois, 1, 0, 0, 0)
        fin   = (datetime(annee + 1, 1, 1, 0, 0, 0) if mois == 12
                 else datetime(annee, mois + 1, 1, 0, 0, 0))

        taux = self._get_taux()

        # Chargement ORM : create_date uniquement (seul champ sûr)
        tous = self.env['revenue.record'].search([
            ('create_date', '>=', debut),
            ('create_date', '<',  fin),
        ])

        # Filtrage 100% Python
        revenus = tous.filtered(
            lambda r: self._revenue_dans_periode(r, debut, fin, zone_id)
        )

        sum_dzd    = sum(revenus.mapped('montant_dzd'))
        sum_eur    = sum(revenus.mapped('montant'))

        remboursements = self._fetch_remboursements(debut, fin, zone_id)
        sum_refund     = sum(remboursements.mapped('amount'))

        tresorerie = (sum_dzd + (sum_eur * taux)) - (sum_refund * taux)

        return {
            'tresorerie' : tresorerie,
            'sum_dzd'    : sum_dzd,
            'sum_eur'    : sum_eur,
            'sum_refund' : sum_refund,
            'taux'       : taux,
        }

    @api.model
    def get_tresorerie_annuelle(self, annee, zone_id=None):
        result = []
        for mois in range(1, 13):
            data = self.get_tresorerie_mois(annee, mois, zone_id=zone_id)
            result.append({'mois': mois, 'tresorerie': data['tresorerie']})
        return result

    @api.model
    def get_tresorerie_par_zone(self, annee):
        zones = self.env['zone'].search([], order='name asc')
        result = []
        for zone in zones:
            total = sum(
                self.get_tresorerie_mois(annee, mois, zone_id=zone.id)['tresorerie']
                for mois in range(1, 13)
            )
            if total > 0:
                result.append({'zone_name': zone.name, 'tresorerie': total})
        return result

    # ──────────────────────────────────────────────────────────────
    # FILTRAGE PYTHON
    # ──────────────────────────────────────────────────────────────

    def _date_effective(self, revenue):
        """
        Priorité métier pour la date d'un revenue :
          1. date_encaissement (si renseignée)
          2. reservation.create_date
          3. create_date du revenue
        """
        if revenue.date_encaissement:
            return revenue.date_encaissement
        if revenue.reservation and revenue.reservation.create_date:
            return revenue.reservation.create_date
        return revenue.create_date or datetime.min

    def _zone_match(self, revenue, zone_id):
        """
        Vérifie la zone d'un revenue en Python.
        On accède aux attributs de l'objet (pas de domain ORM ici).
        Priorité : reservation.zone > zone_autre
        """
        if not zone_id:
            return True
        zone_id = int(zone_id)
        try:
            if revenue.reservation and revenue.reservation.zone:
                return revenue.reservation.zone.id == zone_id
        except Exception:
            pass
        try:
            if revenue.zone_autre:
                return revenue.zone_autre.id == zone_id
        except Exception:
            pass
        return False

    def _revenue_dans_periode(self, revenue, debut, fin, zone_id):
        """
        Retourne True si le revenue appartient à [debut, fin[
        selon les règles des deux périodes.
        """
        try:
            if not self._zone_match(revenue, zone_id):
                return False

            date_eff = self._date_effective(revenue)

            if date_eff == datetime.min:
                return False

            # ── Période ANCIENNE (avant le seuil 01/11/2025) ──────────
            # Date de référence = reservation.create_date ou create_date
            if date_eff < SEUIL:
                if revenue.reservation and revenue.reservation.create_date:
                    ref = revenue.reservation.create_date
                else:
                    ref = revenue.create_date
                if not ref:
                    return False
                return debut <= ref < fin

            # ── Période NOUVELLE (à partir du seuil) ──────────────────
            # _date_effective() a déjà appliqué la bonne priorité
            return debut <= date_eff < fin

        except Exception as e:
            _logger.warning(f"_revenue_dans_periode erreur sur revenue {revenue.id}: {e}")
            return False

    # ──────────────────────────────────────────────────────────────
    # REMBOURSEMENTS
    # ──────────────────────────────────────────────────────────────

    def _fetch_remboursements(self, debut, fin, zone_id=None):
        """
        'date' et 'status' sur refund.table sont des champs directs store=True.
        Pour la zone, on passe par le modèle 'reservation' (champ 'zone' direct).
        """
        domain = [
            ('date',   '>=', debut),
            ('date',   '<',  fin),
            ('status', '=',  'effectuer'),
        ]
        if zone_id:
            # 'zone' sur 'reservation' est un Many2one direct store=True
            reservation_ids = self.env['reservation'].search(
                [('zone', '=', int(zone_id))]
            ).ids
            if not reservation_ids:
                return self.env['refund.table']
            domain.append(('reservation', 'in', reservation_ids))

        return self.env['refund.table'].search(domain)

    def _get_taux(self):
        taux_rec = self.env['taux.change'].search([('id', '=', 2)], limit=1)
        return taux_rec.montant if taux_rec else 1