from django.urls import path
from . import views, api_views

urlpatterns = [
    # Solicitud de Vacaciones
    path('api/vacaciones/datos/',            api_views.DatosFormularioView.as_view(),    name='vac_datos'),
    path('api/vacaciones/calcular-retorno/', api_views.CalcularRetornoView.as_view(),    name='vac_calcular_retorno'),
    path('api/vacaciones/crear/',            api_views.CrearSolicitudView.as_view(),      name='vac_crear'),
    path('api/vacaciones/mis-solicitudes/',  api_views.MisSolicitudesView.as_view(),      name='vac_mis_solicitudes'),
    path('api/vacaciones/seguimiento/',      api_views.SeguimientoSolicitudView.as_view(), name='vac_seguimiento'),
    # Aprobación y/o Rechazo
    path('api/vacaciones/para-aprobar/',     api_views.SolicitudesParaAprobarView.as_view(), name='vac_para_aprobar'),
    path('api/vacaciones/decision/',         api_views.RegistrarDecisionView.as_view(),      name='vac_decision'),
    # Historial RRHH
    path('api/vacaciones/historial-rrhh/',                         api_views.HistorialRRHHView.as_view(),   name='vac_historial_rrhh'),
    path('api/vacaciones/historial-rrhh/pdf/<int:id_formulario>/', api_views.DescargarPDFView.as_view(),    name='vac_pdf'),
    # Gestión de saldo (RRHH)
    path('api/vacaciones/acreditar-gestion/', api_views.AcreditarGestionView.as_view(),    name='vac_acreditar_gestion'),
    path('api/vacaciones/inicializar/',       api_views.InicializarVacacionesView.as_view(), name='vac_inicializar'),
    # Anulación y ajuste (RRHH)
    path('api/vacaciones/anulacion/',           api_views.SolicitudesAnulacionView.as_view(),  name='vac_anulacion_list'),
    path('api/vacaciones/anulacion/registrar/', api_views.RegistrarAnulacionView.as_view(),    name='vac_anulacion_registrar'),
    # Solicitudes Rechazadas (RRHH)
    path('api/vacaciones/rechazadas/',                           api_views.SolicitudesRechazadasView.as_view(),    name='vac_rechazadas'),
    path('api/vacaciones/rechazadas/pdf/<int:id_formulario>/',   api_views.DescargarPDFRechazadaView.as_view(),   name='vac_pdf_rechazada'),
    # Alerta de gestiones a punto de perder días (RRHH)
    path('api/vacaciones/alerta-gestiones-riesgo/', api_views.AlertaGestionesPorPerderView.as_view(), name='vac_alerta_gestiones_riesgo'),
    path('api/vacaciones/alerta-poblar-hoy/',       api_views.AlertaPoblarHoyView.as_view(),           name='vac_alerta_poblar_hoy'),
    # Alerta para Jefe de Area / Gerentes: gestiones vencidas de su gente a cargo
    path('api/vacaciones/alerta-jefe-area/', api_views.AlertaGestionesJefeAreaView.as_view(), name='vac_alerta_jefe_area'),
]
