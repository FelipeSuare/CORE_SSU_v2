from django.urls import path
from . import views

urlpatterns = [
    # Solicitud de Vacaciones
    path('api/vacaciones/datos/',            views.datos_formulario,       name='vac_datos'),
    path('api/vacaciones/calcular-retorno/', views.calcular_retorno_api,   name='vac_calcular_retorno'),
    path('api/vacaciones/crear/',            views.crear_solicitud,         name='vac_crear'),
    path('api/vacaciones/mis-solicitudes/',  views.mis_solicitudes,         name='vac_mis_solicitudes'),
    path('api/vacaciones/seguimiento/',      views.seguimiento_solicitud,   name='vac_seguimiento'),
    # Aprobación y/o Rechazo
    path('api/vacaciones/para-aprobar/',     views.solicitudes_para_aprobar, name='vac_para_aprobar'),
    path('api/vacaciones/decision/',         views.registrar_decision,       name='vac_decision'),
]
