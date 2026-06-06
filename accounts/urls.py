from django.urls import path
from . import views

urlpatterns = [
    path('', views.login_view, name='login_home'),
    path('perfil/foto/', views.foto_perfil, name='perfil_foto'),
    path('perfil/foto/eliminar/', views.eliminar_foto_perfil, name='perfil_foto_eliminar'),
    path('api/usuario/mi-perfil/', views.mi_perfil_api, name='mi_perfil_api'),
    path('recuperar/verificar/', views.recuperar_verificar, name='recuperar_verificar'),
    path('recuperar/nueva/', views.recuperar_nueva_contrasena, name='recuperar_nueva'),
]
