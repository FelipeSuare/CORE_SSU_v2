import json
from datetime import date, datetime
from django.shortcuts import render
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from django.db import IntegrityError
from core.models import Feriado

TIPOS_FERIADO = ['Internacional', 'Nacional', 'Departamental', 'Municipal', 'Institucional']


@login_required(login_url='login_home')
def feriados_view(request):
    return render(request, 'core/Feriados.html', {
        'anio_actual': date.today().year,
        'tipos': TIPOS_FERIADO,
    })


@login_required(login_url='login_home')
def listar_feriados(request):
    anio = request.GET.get('anio', '').strip()
    tipo = request.GET.get('tipo', 'Todos').strip()

    qs = Feriado.objects.order_by('fecha')

    if anio:
        try:
            qs = qs.filter(fecha__year=int(anio))
        except ValueError:
            pass

    if tipo and tipo != 'Todos':
        qs = qs.filter(tipo=tipo)

    return JsonResponse({
        'feriados': [
            {
                'id':          f.id_feriado,
                'fecha':       f.fecha.strftime('%Y-%m-%d'),
                'descripcion': f.descripcion,
                'tipo':        f.tipo,
            }
            for f in qs
        ]
    })


@login_required(login_url='login_home')
@require_POST
def agregar_feriado(request):
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Solicitud inválida.'}, status=400)

    fecha_str   = body.get('fecha', '').strip()
    descripcion = body.get('descripcion', '').strip()
    tipo        = body.get('tipo', '').strip()

    if not fecha_str or not descripcion or not tipo:
        return JsonResponse({'error': 'Todos los campos son obligatorios.'}, status=400)

    if tipo not in TIPOS_FERIADO:
        return JsonResponse({'error': 'Tipo de feriado inválido.'}, status=400)

    try:
        fecha = datetime.strptime(fecha_str, '%Y-%m-%d').date()
    except ValueError:
        return JsonResponse({'error': 'Formato de fecha inválido.'}, status=400)

    if Feriado.objects.filter(fecha=fecha).exists():
        return JsonResponse({'error': 'Ya existe un feriado registrado para esa fecha.'}, status=400)

    try:
        feriado = Feriado.objects.create(fecha=fecha, descripcion=descripcion, tipo=tipo)
    except IntegrityError:
        return JsonResponse({'error': 'Ya existe un feriado registrado para esa fecha.'}, status=400)

    return JsonResponse({
        'ok': True,
        'feriado': {
            'id':          feriado.id_feriado,
            'fecha':       feriado.fecha.strftime('%Y-%m-%d'),
            'descripcion': feriado.descripcion,
            'tipo':        feriado.tipo,
        },
    }, status=201)


@login_required(login_url='login_home')
@require_POST
def editar_feriado(request, id_feriado):
    try:
        feriado = Feriado.objects.get(id_feriado=id_feriado)
    except Feriado.DoesNotExist:
        return JsonResponse({'error': 'Feriado no encontrado.'}, status=404)

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Solicitud inválida.'}, status=400)

    fecha_str   = body.get('fecha', '').strip()
    descripcion = body.get('descripcion', '').strip()
    tipo        = body.get('tipo', '').strip()

    if not fecha_str or not descripcion or not tipo:
        return JsonResponse({'error': 'Todos los campos son obligatorios.'}, status=400)

    if tipo not in TIPOS_FERIADO:
        return JsonResponse({'error': 'Tipo de feriado inválido.'}, status=400)

    try:
        fecha = datetime.strptime(fecha_str, '%Y-%m-%d').date()
    except ValueError:
        return JsonResponse({'error': 'Formato de fecha inválido.'}, status=400)

    if Feriado.objects.filter(fecha=fecha).exclude(id_feriado=id_feriado).exists():
        return JsonResponse({'error': 'Ya existe un feriado registrado para esa fecha.'}, status=400)

    feriado.fecha       = fecha
    feriado.descripcion = descripcion
    feriado.tipo        = tipo
    try:
        feriado.save(update_fields=['fecha', 'descripcion', 'tipo'])
    except IntegrityError:
        return JsonResponse({'error': 'Ya existe un feriado registrado para esa fecha.'}, status=400)

    return JsonResponse({'ok': True})


@login_required(login_url='login_home')
@require_POST
def eliminar_feriado(request, id_feriado):
    try:
        feriado = Feriado.objects.get(id_feriado=id_feriado)
    except Feriado.DoesNotExist:
        return JsonResponse({'error': 'Feriado no encontrado.'}, status=404)

    feriado.delete()
    return JsonResponse({'ok': True})
