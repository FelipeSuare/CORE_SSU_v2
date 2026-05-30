from django.urls import path
from . import views

urlpatterns = [
    path('feriados/lista/',                views.listar_feriados, name='feriados_lista'),
    path('feriados/agregar/',              views.agregar_feriado,  name='feriados_agregar'),
    path('feriados/<int:id_feriado>/editar/',   views.editar_feriado,   name='feriados_editar'),
    path('feriados/<int:id_feriado>/eliminar/', views.eliminar_feriado, name='feriados_eliminar'),
]
