from odoo import models, fields, api

class DashboardStatistiques(models.Model):
    _name = 'dashboard.statistiques'
    _description = 'Dashboard Statistiques'

    name = fields.Char(string='Nom', required=True)
    date = fields.Date(string='Date', default=fields.Date.today)
    total_ventes = fields.Float(string='Total Ventes')
    total_clients = fields.Integer(string='Total Clients')
    total_commandes = fields.Integer(string='Total Commandes')