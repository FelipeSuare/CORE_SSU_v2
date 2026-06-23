from django.urls import path
from . import views, api_views

urlpatterns = [
    path('funcionarios/lista/',                      api_views.ListarFuncionariosView.as_view(),  name='funcionarios_lista'),
    path('funcionarios/aprobadores/',                api_views.AprobadoresView.as_view(),          name='funcionarios_aprobadores'),
    path('funcionarios/nuevo/',                      api_views.NuevoFuncionarioView.as_view(),     name='funcionarios_nuevo'),
    path('funcionarios/exportar/',                   views.exportar_funcionarios,                  name='funcionarios_exportar'),
    path('funcionarios/buscar/',                     api_views.BuscarFuncionariosView.as_view(),   name='funcionarios_buscar'),
    path('funcionarios/<str:cod>/editar/',           api_views.EditarFuncionarioView.as_view(),    name='funcionarios_editar'),
    path('funcionarios/<str:cod>/estado/',           api_views.ToggleEstadoView.as_view(),          name='funcionarios_estado'),
    path('funcionarios/<str:cod>/historial-cargos/', api_views.HistorialCargosView.as_view(),      name='funcionarios_historial_cargos'),
    path('funcionarios/<str:cod>/vacaciones-baja-pdf/', api_views.VacacionesBajaPDFView.as_view(), name='funcionarios_vacaciones_baja_pdf'),
]
