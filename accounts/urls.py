from django.urls import path
from . import views

urlpatterns = [
    path('', views.login_view, name='login_home'),
    path('perfil/foto/', views.foto_perfil, name='perfil_foto'),
    path('perfil/foto/eliminar/', views.eliminar_foto_perfil, name='perfil_foto_eliminar'),
    path('api/usuario/mi-perfil/', views.mi_perfil_api, name='mi_perfil_api'),
]
