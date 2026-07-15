import re
from datetime import date

from django.contrib.auth.hashers import make_password
from django.contrib.auth.models import User
from django.contrib.auth import update_session_auth_hash
from django.core.cache import cache
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from rest_framework import status

from core.api_permissions import NoCambioPendiente, EsFuncionarioActivo
from employees.models import Persona, Funcionario
from accounts.models import FuncionarioRol

_PATRON_CONTRASENA = re.compile(
    r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#]).{8,}$'
)


def _incrementar_intentos_rec(ci):
    intentos_key = f'rec_intentos_{ci}'
    bloqueo_key  = f'rec_bloqueado_{ci}'
    intentos = (cache.get(intentos_key) or 0) + 1
    if intentos >= 3:
        cache.set(bloqueo_key, True, 15 * 60)
        cache.delete(intentos_key)
    else:
        cache.set(intentos_key, intentos, 15 * 60)


class EliminarFotoView(APIView):
    permission_classes = [NoCambioPendiente, EsFuncionarioActivo]

    def post(self, request):
        try:
            persona = Persona.objects.get(ci=request.user.username)
        except Persona.DoesNotExist:
            return Response({'error': 'Funcionario no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        persona.foto = None
        persona.save(update_fields=['foto'])
        return Response({'ok': True})


class MiPerfilView(APIView):
    permission_classes = [NoCambioPendiente, EsFuncionarioActivo]

    def get(self, request):
        try:
            f = Funcionario.objects.select_related('ci').get(
                ci__ci=request.user.username, estado='ACTIVO'
            )
        except Funcionario.DoesNotExist:
            return Response({'error': 'Funcionario no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        p = f.ci
        roles = list(
            FuncionarioRol.objects.filter(cod_funcionario=f, activo=True)
            .values_list('id_roles__tipo_rol', flat=True)
        )
        if 'Funcionario' not in roles:
            roles.insert(0, 'Funcionario')
        roles.sort(key=lambda r: (r != 'Funcionario', r))

        nombre_completo = f"{p.nombre} {p.ap_paterno} {p.ap_materno or ''}".strip()
        partes = nombre_completo.split()
        nombre_abreviado = (
            f"{partes[0]} {partes[1][0]}." if len(partes) >= 2 else nombre_completo
        )

        return Response({
            'cod_funcionario':  f.cod_funcionario,
            'nombre_completo':  nombre_completo,
            'nombre_abreviado': nombre_abreviado,
            'roles':            roles,
            'ci':               p.ci,
        })


class RecuperarVerificarView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        ci            = request.data.get('ci', '').strip()
        fecha_nac_str = request.data.get('fecha_nacimiento', '').strip()
        matricula     = request.data.get('matricula_seguro', '').strip()

        if not all([ci, fecha_nac_str, matricula]):
            return Response(
                {'error': 'Todos los campos son obligatorios.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if cache.get(f'rec_bloqueado_{ci}'):
            return Response(
                {'error': 'Demasiados intentos fallidos. Intente nuevamente en 15 minutos.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        try:
            fecha_nac = date.fromisoformat(fecha_nac_str)
        except ValueError:
            return Response(
                {'error': 'Formato de fecha inválido.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        _ERROR = 'Los datos ingresados no coinciden con ningún registro.'

        try:
            persona     = Persona.objects.get(ci=ci)
            funcionario = Funcionario.objects.get(ci=persona, estado='ACTIVO')
        except (Persona.DoesNotExist, Funcionario.DoesNotExist):
            _incrementar_intentos_rec(ci)
            return Response({'error': _ERROR}, status=status.HTTP_400_BAD_REQUEST)

        if persona.fecha_nacimiento != fecha_nac:
            _incrementar_intentos_rec(ci)
            return Response({'error': _ERROR}, status=status.HTTP_400_BAD_REQUEST)

        if not funcionario.matricula_seguro or funcionario.matricula_seguro.strip() != matricula:
            _incrementar_intentos_rec(ci)
            return Response({'error': _ERROR}, status=status.HTTP_400_BAD_REQUEST)

        cache.delete(f'rec_intentos_{ci}')
        request.session['recuperacion_ci'] = ci
        request.session.set_expiry(10 * 60)

        return Response({'ok': True})


class RecuperarNuevaView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        ci = request.session.get('recuperacion_ci')
        if not ci:
            return Response(
                {'error': 'Sesión de recuperación expirada. Vuelva a verificar sus datos.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        nueva     = request.data.get('nueva', '').strip()
        confirmar = request.data.get('confirmar', '').strip()

        if not nueva or not confirmar:
            return Response(
                {'error': 'Todos los campos son obligatorios.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if nueva != confirmar:
            return Response(
                {'error': 'Las contraseñas no coinciden.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not _PATRON_CONTRASENA.match(nueva):
            return Response(
                {'error': 'La contraseña no cumple con los requisitos de seguridad.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            persona     = Persona.objects.get(ci=ci)
            funcionario = Funcionario.objects.get(ci=persona)
            user        = User.objects.get(username=ci)
        except (Persona.DoesNotExist, Funcionario.DoesNotExist, User.DoesNotExist):
            return Response(
                {'error': 'No se encontró el registro del funcionario.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        funcionario.contrasena_hash = make_password(nueva)
        funcionario.save(update_fields=['contrasena_hash'])
        user.set_password(nueva)
        user.save()

        request.session.pop('recuperacion_ci', None)
        return Response({'ok': True})
