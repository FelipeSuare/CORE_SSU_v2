from django.urls import path
from . import views

urlpatterns = [
    path('funcionarios/lista/',                     views.listar_funcionarios,  name='funcionarios_lista'),
    path('funcionarios/aprobadores/',               views.aprobadores_api,      name='funcionarios_aprobadores'),
    path('funcionarios/nuevo/',                     views.nuevo_funcionario,     name='funcionarios_nuevo'),
    path('funcionarios/exportar/',                  views.exportar_funcionarios, name='funcionarios_exportar'),
    path('funcionarios/<str:cod>/editar/',          views.editar_funcionario,    name='funcionarios_editar'),
    path('funcionarios/<str:cod>/estado/',          views.toggle_estado,         name='funcionarios_estado'),
]
