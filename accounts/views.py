import json
import re
from datetime import date
from django.shortcuts import render, redirect
from django.contrib import messages
from django.contrib.auth import authenticate, login, update_session_auth_hash
from django.contrib.auth.models import User
from django.core.cache import cache
from django.contrib.auth.decorators import login_required
from django.contrib.auth.hashers import make_password, check_password as django_check_password
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_POST
from employees.models import Persona, Funcionario, HistorialCargo
from accounts.models import FuncionarioRol

_PATRON_CONTRASENA = re.compile(
    r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#]).{8,}$'
)


_LOGIN_MAX_INTENTOS = 5
_LOGIN_BLOQUEO_SEGUNDOS = 15 * 60  # 15 minutos


def _clave_login(usuario):
    return f'login_intentos_{usuario}', f'login_bloqueado_{usuario}'


def login_view(request):
    if request.method == 'POST':
        usuario    = (request.POST.get('username') or '').strip()
        contrasena = request.POST.get('password') or ''

        if not usuario:
            messages.error(request, 'Usuario o contraseña incorrectos.')
            return redirect('login_home')

        clave_intentos, clave_bloqueo = _clave_login(usuario)

        if cache.get(clave_bloqueo):
            messages.error(request, 'Cuenta bloqueada temporalmente por demasiados intentos fallidos. Intente en 15 minutos.')
            return redirect('login_home')

        user = authenticate(request, username=usuario, password=contrasena)
        if user is not None:
            cache.delete(clave_intentos)
            cache.delete(clave_bloqueo)
            try:
                func = Funcionario.objects.get(ci__ci=user.username)
                if func.estado != 'ACTIVO':
                    messages.error(
                        request,
                        'Su acceso ha sido deshabilitado. Comuníquese con RRHH.',
                    )
                    return redirect('login_home')
                login(request, user)
                if func.contrasena_hash == '1234567':
                    request.session['debe_cambiar_contrasena'] = True
                    return redirect('contrasena')
            except Funcionario.DoesNotExist:
                login(request, user)
            return redirect('index')
        else:
            intentos = (cache.get(clave_intentos) or 0) + 1
            if intentos >= _LOGIN_MAX_INTENTOS:
                cache.set(clave_bloqueo, True, _LOGIN_BLOQUEO_SEGUNDOS)
                cache.delete(clave_intentos)
                messages.error(request, 'Cuenta bloqueada temporalmente por demasiados intentos fallidos. Intente en 15 minutos.')
            else:
                cache.set(clave_intentos, intentos, _LOGIN_BLOQUEO_SEGUNDOS)
                restantes = _LOGIN_MAX_INTENTOS - intentos
                messages.error(request, f'Usuario o contraseña incorrectos. Intentos restantes: {restantes}.')
            return redirect('login_home')
    return render(request, 'accounts/loging.html')


def _calcular_duracion(fecha_inicio, fecha_fin=None):
    fin = fecha_fin or date.today()
    años = fin.year - fecha_inicio.year
    meses = fin.month - fecha_inicio.month
    if meses < 0:
        años -= 1
        meses += 12
    partes = []
    if años > 0:
        partes.append(f"{años} año{'s' if años > 1 else ''}")
    if meses > 0:
        partes.append(f"{meses} mes{'es' if meses > 1 else ''}")
    return ' y '.join(partes) if partes else 'Menos de un mes'


def _icono_para_rol(nombre_rol):
    nombre = nombre_rol.lower()
    if 'admin' in nombre:
        return 'shield'
    if 'gerente' in nombre or 'jefe' in nombre:
        return 'manage_accounts'
    if 'recursos' in nombre or 'rrhh' in nombre:
        return 'groups'
    return 'badge'


_FIRMAS_IMAGEN = (
    (b'\xff\xd8\xff',       'image/jpeg'),
    (b'\x89PNG\r\n\x1a\n',  'image/png'),
    (b'GIF87a',             'image/gif'),
    (b'GIF89a',             'image/gif'),
)


def _detectar_content_type(data):
    for firma, mime in _FIRMAS_IMAGEN:
        if data[:len(firma)] == firma:
            return mime
    return None


def _es_imagen_valida(data: bytes) -> bool:
    return _detectar_content_type(data) is not None


@login_required(login_url='login_home')
def perfil_view(request):
    persona = None
    funcionario = None
    historial_data = []
    roles_data = []
    nombre_completo = ''
    fecha_nacimiento_display = ''
    fecha_ingreso_display = ''

    try:
        persona = Persona.objects.get(ci=request.user.username)
        funcionario = Funcionario.objects.select_related('id_unidad').get(ci=persona)

        nombre_completo = ' '.join(filter(None, [
            persona.nombre, persona.ap_paterno, persona.ap_materno
        ]))
        fecha_nacimiento_display = persona.fecha_nacimiento.strftime('%d/%m/%Y')
        fecha_ingreso_display = funcionario.fecha_ingreso.strftime('%d/%m/%Y')

        unidad_nombre = funcionario.id_unidad.nombre

        for h in HistorialCargo.objects.filter(
            cod_funcionario=funcionario
        ).order_by('-fecha_inicio'):
            fecha_fin_texto = (
                'Actualidad' if h.es_actual
                else h.fecha_fin.strftime('%d/%m/%Y') if h.fecha_fin
                else 'Actualidad'
            )
            historial_data.append({
                'cargo': h.cargo,
                'unidad': unidad_nombre,
                'fecha_inicio_display': h.fecha_inicio.strftime('%d/%m/%Y'),
                'fecha_fin_display': fecha_fin_texto,
                'es_actual': h.es_actual,
                'tipo_contrato': h.tipo_contrato,
                'duracion': _calcular_duracion(h.fecha_inicio, h.fecha_fin),
                'periodo': f"{h.fecha_inicio.strftime('%d/%m/%Y')} — {fecha_fin_texto}",
            })

        for fr in FuncionarioRol.objects.filter(
            cod_funcionario=funcionario
        ).select_related('id_roles').order_by('-activo', 'id_roles__tipo_rol'):
            roles_data.append({
                'nombre': fr.id_roles.tipo_rol,
                'descripcion': fr.id_roles.descripcion or '',
                'activo': fr.activo,
                'icono': _icono_para_rol(fr.id_roles.tipo_rol),
            })

    except (Persona.DoesNotExist, Funcionario.DoesNotExist):
        nombre_completo = request.user.get_full_name() or request.user.username

    cargo_actual = next((h for h in historial_data if h['es_actual']), None)

    context = {
        'persona': persona,
        'funcionario': funcionario,
        'cargo_actual': cargo_actual,
        'historial_cargos': historial_data,
        'roles': roles_data,
        'nombre_completo': nombre_completo,
        'fecha_nacimiento_display': fecha_nacimiento_display,
        'fecha_ingreso_display': fecha_ingreso_display,
        'tiene_foto': bool(persona and persona.foto),
        'mostrar_expandir_historial': len(historial_data) > 2,
        'mostrar_expandir_roles': len(roles_data) > 2,
    }
    return render(request, 'accounts/Perfil_Usuario.html', context)


@login_required(login_url='login_home')
def foto_perfil(request):
    try:
        persona = Persona.objects.get(ci=request.user.username)
    except Persona.DoesNotExist:
        return HttpResponse(status=404)

    if request.method == 'GET':
        if not persona.foto:
            return HttpResponse(status=404)
        foto_bytes = bytes(persona.foto)
        mime = _detectar_content_type(foto_bytes) or 'image/jpeg'
        return HttpResponse(foto_bytes, content_type=mime)

    if request.method == 'POST':
        archivo = request.FILES.get('foto')
        if not archivo:
            return JsonResponse({'error': 'No se recibió ningún archivo.'}, status=400)
        if archivo.size > 5 * 1024 * 1024:
            return JsonResponse({'error': 'La imagen supera el límite de 5MB.'}, status=400)
        datos = archivo.read()
        if not _es_imagen_valida(datos):
            return JsonResponse({'error': 'El archivo no es una imagen válida (JPG, PNG o GIF).'}, status=400)
        persona.foto = datos
        persona.save(update_fields=['foto'])
        return JsonResponse({'ok': True})

    return HttpResponse(status=405)


@login_required(login_url='login_home')
@require_POST
def eliminar_foto_perfil(request):
    try:
        persona = Persona.objects.get(ci=request.user.username)
    except Persona.DoesNotExist:
        return JsonResponse({'error': 'Funcionario no encontrado.'}, status=404)
    persona.foto = None
    persona.save(update_fields=['foto'])
    return JsonResponse({'ok': True})


# ──────────────────────────────────────────────────────────────
#  Cambio de contraseña
# ──────────────────────────────────────────────────────────────

def _verificar_contrasena(ingresada, almacenada):
    """Verifica contra hash Django o texto plano (contraseñas iniciales)."""
    if django_check_password(ingresada, almacenada):
        return True
    return ingresada == almacenada


@login_required(login_url='login_home')
def cambiar_contrasena_view(request):
    if request.method == 'GET':
        forzado = request.session.get('debe_cambiar_contrasena', False)
        return render(request, 'accounts/Seguridad.html', {'forzado': forzado})

    if request.method == 'POST':
        try:
            data = json.loads(request.body)
        except (json.JSONDecodeError, ValueError):
            return JsonResponse({'error': 'Solicitud inválida.'}, status=400)

        actual    = data.get('actual', '').strip()
        nueva     = data.get('nueva', '').strip()
        confirmar = data.get('confirmar', '').strip()

        if not actual or not nueva or not confirmar:
            return JsonResponse({'error': 'Todos los campos son obligatorios.'}, status=400)

        if nueva != confirmar:
            return JsonResponse(
                {'error': 'La confirmación de contraseña no coincide con la nueva contraseña.'},
                status=400,
            )

        if not _PATRON_CONTRASENA.match(nueva):
            return JsonResponse(
                {'error': 'La nueva contraseña no cumple con los requisitos de seguridad.'},
                status=400,
            )

        try:
            persona     = Persona.objects.get(ci=request.user.username)
            funcionario = Funcionario.objects.get(ci=persona)
        except (Persona.DoesNotExist, Funcionario.DoesNotExist):
            return JsonResponse({'error': 'No se encontró el registro del funcionario.'}, status=404)

        if not _verificar_contrasena(actual, funcionario.contrasena_hash):
            return JsonResponse(
                {'error': 'La contraseña actual ingresada no es correcta.'},
                status=400,
            )

        # Actualizar hash en tabla funcionario
        funcionario.contrasena_hash = make_password(nueva)
        funcionario.save(update_fields=['contrasena_hash'])

        # Actualizar contraseña en auth_user y mantener la sesión activa
        request.user.set_password(nueva)
        request.user.save()
        update_session_auth_hash(request, request.user)

        # Limpiar flag de cambio forzado si estaba activo
        request.session.pop('debe_cambiar_contrasena', None)

        return JsonResponse({'ok': True})

    return HttpResponse(status=405)


# ──────────────────────────────────────────────────────────────
#  Recuperación de contraseña (sin email)
# ──────────────────────────────────────────────────────────────

def recuperar_contrasena_view(request):
    return render(request, 'accounts/Recuperar_Contrasena.html')


def _incrementar_intentos_rec(ci):
    intentos_key = f'rec_intentos_{ci}'
    bloqueo_key  = f'rec_bloqueado_{ci}'
    intentos = (cache.get(intentos_key) or 0) + 1
    if intentos >= 3:
        cache.set(bloqueo_key, True, 15 * 60)
        cache.delete(intentos_key)
    else:
        cache.set(intentos_key, intentos, 15 * 60)


@require_POST
def recuperar_verificar(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Solicitud inválida.'}, status=400)

    ci            = data.get('ci', '').strip()
    fecha_nac_str = data.get('fecha_nacimiento', '').strip()
    matricula     = data.get('matricula_seguro', '').strip()

    if not all([ci, fecha_nac_str, matricula]):
        return JsonResponse({'error': 'Todos los campos son obligatorios.'}, status=400)

    if cache.get(f'rec_bloqueado_{ci}'):
        return JsonResponse(
            {'error': 'Demasiados intentos fallidos. Intente nuevamente en 15 minutos.'},
            status=429,
        )

    try:
        fecha_nac = date.fromisoformat(fecha_nac_str)
    except ValueError:
        return JsonResponse({'error': 'Formato de fecha inválido.'}, status=400)

    _ERROR = 'Los datos ingresados no coinciden con ningún registro.'

    try:
        persona     = Persona.objects.get(ci=ci)
        funcionario = Funcionario.objects.get(ci=persona, estado='ACTIVO')
    except (Persona.DoesNotExist, Funcionario.DoesNotExist):
        _incrementar_intentos_rec(ci)
        return JsonResponse({'error': _ERROR}, status=400)

    if persona.fecha_nacimiento != fecha_nac:
        _incrementar_intentos_rec(ci)
        return JsonResponse({'error': _ERROR}, status=400)

    if not funcionario.matricula_seguro or funcionario.matricula_seguro.strip() != matricula:
        _incrementar_intentos_rec(ci)
        return JsonResponse({'error': _ERROR}, status=400)

    # Verificación exitosa — guardar CI en sesión temporal
    cache.delete(f'rec_intentos_{ci}')
    request.session['recuperacion_ci'] = ci
    request.session.set_expiry(10 * 60)  # 10 minutos para completar el paso 2

    return JsonResponse({'ok': True})


@require_POST
def recuperar_nueva_contrasena(request):
    ci = request.session.get('recuperacion_ci')
    if not ci:
        return JsonResponse(
            {'error': 'Sesión de recuperación expirada. Vuelva a verificar sus datos.'},
            status=403,
        )

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Solicitud inválida.'}, status=400)

    nueva     = data.get('nueva', '').strip()
    confirmar = data.get('confirmar', '').strip()

    if not nueva or not confirmar:
        return JsonResponse({'error': 'Todos los campos son obligatorios.'}, status=400)

    if nueva != confirmar:
        return JsonResponse({'error': 'Las contraseñas no coinciden.'}, status=400)

    if not _PATRON_CONTRASENA.match(nueva):
        return JsonResponse(
            {'error': 'La contraseña no cumple con los requisitos de seguridad.'},
            status=400,
        )

    try:
        persona     = Persona.objects.get(ci=ci)
        funcionario = Funcionario.objects.get(ci=persona)
        user        = User.objects.get(username=ci)
    except Exception:
        return JsonResponse({'error': 'No se encontró el registro del funcionario.'}, status=404)

    funcionario.contrasena_hash = make_password(nueva)
    funcionario.save(update_fields=['contrasena_hash'])
    user.set_password(nueva)
    user.save()

    try:
        del request.session['recuperacion_ci']
    except KeyError:
        pass

    return JsonResponse({'ok': True})


# ──────────────────────────────────────────────────────────────
#  API compartida: perfil del usuario autenticado
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
def mi_perfil_api(request):
    """Nombre completo + roles activos del funcionario autenticado."""
    try:
        f = Funcionario.objects.select_related('ci').get(
            ci__ci=request.user.username, estado='ACTIVO'
        )
    except Funcionario.DoesNotExist:
        return JsonResponse({'error': 'Funcionario no encontrado.'}, status=404)

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

    return JsonResponse({
        'cod_funcionario': f.cod_funcionario,
        'nombre_completo': nombre_completo,
        'nombre_abreviado': nombre_abreviado,
        'ci': p.ci,
        'roles': roles,
    })
