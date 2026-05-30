from django.urls import include
"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path
from django.views.generic import TemplateView
from accounts import views as accounts_views
from core import views as core_views
from employees import views as employees_views
from vacations import views as vacations_views

urlpatterns = [
    path('admin/', admin.site.urls),

    # Login y Dashboard Principal
    path('', include('accounts.urls')),
    path('', include('core.urls')),
    path('', include('employees.urls')),
    path('', include('vacations.urls')),
    path('loging.html', TemplateView.as_view(template_name="accounts/loging.html"), name='login'),
    path('Index_Principal.html', TemplateView.as_view(template_name="dashboard/Index_Principal.html"), name='index'),

    # Accounts
    path('Perfil.html', accounts_views.perfil_view, name='perfil'),
    path('Contrasena.html', accounts_views.cambiar_contrasena_view, name='contrasena'),

    # Core
    path('Feriados.html', core_views.feriados_view, name='feriados'),

    # Employees
    path('Funcionarios.html', employees_views.funcionarios_view, name='funcionarios'),
    path('HistorialCargos.html', TemplateView.as_view(template_name="employees/HistorialCargos.html"), name='historial_cargos'),

    # Vacations — páginas con contexto de sesión
    path('Vacaciones.html', vacations_views.vacaciones_view, name='vacaciones'),
    path('Solicitudes.html', vacations_views.historial_solicitudes_view, name='solicitudes'),
    path('Aprobacion.html', vacations_views.aprobacion_view, name='aprobacion'),
    path('FormularioVac.html', TemplateView.as_view(template_name="vacations/Frm_Solicitud.html"), name='formulario_vac'),
    path('Anulacion.html', TemplateView.as_view(template_name="vacations/Anulación.html"), name='anulacion'),

    # Reports
    path('ReporteP.html', TemplateView.as_view(template_name="reports/ReporteP.html"), name='reporte_p'),
    path('ReporteG.html', TemplateView.as_view(template_name="reports/ReporteG.html"), name='reporte_g'),
]




