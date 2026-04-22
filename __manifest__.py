{
    'name': 'Dashboard Analytics',
    'version': '1.0',
    'summary': 'Module de statistiques et analytics',
    'description': 'Dashboard pour visualiser les statistiques',
    'author': 'Ton Nom',
    'category': 'Reporting',
    'depends': ['base', 'web', 'reservation'],
    'data': [
        'views/dashboard_statistiques_views.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'dashboard_analytics/static/src/js/dashboard_statistiques.js',
            'dashboard_analytics/static/src/xml/dashboard_statistiques.xml',
        ],
    },
    'installable': True,
    'auto_install': False,
    'application': True,
}