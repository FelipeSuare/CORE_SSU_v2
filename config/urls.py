"""
URL configuration for config project.
"""
from django.contrib import admin
from django.urls import path, include
from django.views.generic import TemplateView
from accounts import views as accounts_views
from core import views as core_views
from employees import views as employees_views
from vacations import views as vacations_views
from reports import views as reports_views

urlpatterns = [
    path('admin/', admin.site.urls),

    # Login y Dashboard Principal
    path('', include('accounts.urls')),
    path('', include('core.urls')),
    path('', include('employees.urls')),
    path('', include('vacations.urls')),
    path('', include('reports.urls')),
    path('loging.html', TemplateView.as_view(template_name="accounts/loging.html"), name='login'),
    path('Index_Principal.html', TemplateView.as_view(template_name="dashboard/Index_Principal.html"), name='index'),

    # Accounts
    path('Perfil.html', accounts_views.perfil_view, name='perfil'),
    path('Contrasena.html', accounts_views.cambiar_contrasena_view, name='contrasena'),
    path('Recuperar.html', accounts_views.recuperar_contrasena_view, name='recuperar'),

    # Core
    path('Feriados.html', core_views.feriados_view, name='feriados'),

    # Employees
    path('Funcionarios.html', employees_views.funcionarios_view, name='funcionarios'),
    path('HistorialCargos.html', employees_views.historial_cargos_view, name='historial_cargos'),

    # Vacations
    path('Vacaciones.html', vacations_views.vacaciones_view, name='vacaciones'),
    path('Solicitudes.html', vacations_views.historial_solicitudes_view, name='solicitudes'),
    path('Aprobacion.html', vacations_views.aprobacion_view, name='aprobacion'),
    path('FormularioVac.html', vacations_views.historial_rrhh_view, name='formulario_vac'),
    path('Anulacion.html', vacations_views.anulacion_view, name='anulacion'),
    path('HistorialRRHH.html', vacations_views.historial_rrhh_view, name='historial_rrhh'),

    # Reports
    path('ReporteP.html', reports_views.reporte_personal_view, name='reporte_p'),
    path('ReporteG.html', reports_views.reporte_general_view, name='reporte_g'),
]
