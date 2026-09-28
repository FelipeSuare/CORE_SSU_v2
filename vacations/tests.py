from datetime import date, timedelta
from decimal import Decimal

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from django.test import TestCase

from vacations.utils import (
    calcular_anios_antiguedad,
    calcular_gestioneS_pendientes,
    dias_por_antiguedad,
    aplicar_limite_gestiones_activas,
)
from vacations.api_views import _calcular_retorno
from core.models import Feriado
from vacations.models import GestionVacacion, JerarquiaAprobacion, SolicitudVacacion
from core.test_utils import hacer_usuario_y_funcionario, hacer_gestion, hacer_cargo, hacer_funcionario


# ══════════════════════════════════════════════════════════════════════════════
#  Funciones puras — no usan DB
# ══════════════════════════════════════════════════════════════════════════════

class TestCalcularAniosAntiguedad(TestCase):
    """Años completos de servicio, incluyendo bordes de aniversario."""

    def test_exactamente_un_anio(self):
        self.assertEqual(calcular_anios_antiguedad(date(2020, 6, 15), date(2021, 6, 15)), 1)

    def test_un_dia_antes_del_aniversario(self):
        self.assertEqual(calcular_anios_antiguedad(date(2020, 6, 15), date(2021, 6, 14)), 0)

    def test_un_dia_despues_del_aniversario(self):
        self.assertEqual(calcular_anios_antiguedad(date(2020, 6, 15), date(2021, 6, 16)), 1)

    def test_cinco_anios_exactos(self):
        self.assertEqual(calcular_anios_antiguedad(date(2015, 1, 1), date(2020, 1, 1)), 5)

    def test_diez_anios_exactos(self):
        self.assertEqual(calcular_anios_antiguedad(date(2010, 3, 20), date(2020, 3, 20)), 10)

    def test_fecha_ingreso_hoy_cero_anios(self):
        hoy = date.today()
        self.assertEqual(calcular_anios_antiguedad(hoy, hoy), 0)

    def test_referencia_anterior_a_ingreso_devuelve_cero(self):
        self.assertEqual(calcular_anios_antiguedad(date(2025, 1, 1), date(2020, 1, 1)), 0)

    def test_bisiesto_29feb_ref_28feb_siguiente(self):
        # Ingresó en año bisiesto. El 28/02 del año siguiente NO es su aniversario.
        self.assertEqual(calcular_anios_antiguedad(date(2020, 2, 29), date(2021, 2, 28)), 0)

    def test_bisiesto_29feb_ref_01mar_siguiente(self):
        self.assertEqual(calcular_anios_antiguedad(date(2020, 2, 29), date(2021, 3, 1)), 1)

    def test_quince_anios(self):
        self.assertEqual(calcular_anios_antiguedad(date(2005, 7, 4), date(2020, 7, 4)), 15)


class TestDiasPorAntiguedad(TestCase):
    """Tabla LGT Bolivia: <1→0, 1-4→15, 5-9→20, 10+→30."""

    def test_cero_anios(self):
        self.assertEqual(dias_por_antiguedad(0), Decimal('0'))

    def test_un_anio(self):
        self.assertEqual(dias_por_antiguedad(1), Decimal('15'))

    def test_cuatro_anios(self):
        self.assertEqual(dias_por_antiguedad(4), Decimal('15'))

    def test_cinco_anios_exactos_salta_a_20(self):
        self.assertEqual(dias_por_antiguedad(5), Decimal('20'))

    def test_nueve_anios(self):
        self.assertEqual(dias_por_antiguedad(9), Decimal('20'))

    def test_diez_anios_exactos_salta_a_30(self):
        self.assertEqual(dias_por_antiguedad(10), Decimal('30'))

    def test_veinte_anios(self):
        self.assertEqual(dias_por_antiguedad(20), Decimal('30'))


class TestCalcularRetorno(TestCase):
    """
    Cálculo de fecha de retorno avanzando días hábiles.
    fecha_retorno = primer día posterior al último día de vacación.
    """

    def _run(self, fecha_salida, dias, feriados=None):
        return _calcular_retorno(fecha_salida, dias, feriados or set())

    # ── Casos básicos ──────────────────────────────────────────────────────────

    def test_cinco_dias_desde_lunes(self):
        # Lun 8/1 → vie 12/1 (5 hábiles), sin fines de semana cruzados.
        # fecha_retorno = sáb 13/1 (primer día después del bloque)
        r = self._run(date(2024, 1, 8), Decimal('5'))
        self.assertEqual(r['fecha_retorno'], date(2024, 1, 13))
        self.assertEqual(r['dias_fines_semana'], 0)
        self.assertEqual(r['dias_feriados'], 0)

    def test_cinco_dias_desde_jueves_cruza_fin_de_semana(self):
        # Jue 11/1 + vie 12/1 (2) + sáb-dom skip + lun 15 + mar 16 + mié 17/1 (5)
        r = self._run(date(2024, 1, 11), Decimal('5'))
        self.assertEqual(r['fecha_retorno'], date(2024, 1, 18))
        self.assertEqual(r['dias_fines_semana'], 2)

    def test_un_dia_desde_sabado_salta_fin_de_semana(self):
        # Sáb 13/1 y dom 14/1 se saltean; primer hábil = lun 15/1
        r = self._run(date(2024, 1, 13), Decimal('1'))
        self.assertEqual(r['fecha_retorno'], date(2024, 1, 16))
        self.assertEqual(r['dias_fines_semana'], 2)

    def test_quince_dias_desde_lunes(self):
        # 3 semanas exactas de lunes a viernes, 2 fines de semana cruzados (4 días)
        r = self._run(date(2024, 1, 8), Decimal('15'))
        self.assertEqual(r['fecha_retorno'], date(2024, 1, 27))
        self.assertEqual(r['dias_fines_semana'], 4)

    # ── Feriados ───────────────────────────────────────────────────────────────

    def test_feriado_en_habil_extiende_vacation(self):
        # 5 hábiles desde lun 8/1, feriado el mié 10/1
        # Debe agregar 1 día extra: retorno = mar 16/1 en vez de sáb 13/1
        feriados = {date(2024, 1, 10)}
        r = self._run(date(2024, 1, 8), Decimal('5'), feriados=feriados)
        self.assertEqual(r['fecha_retorno'], date(2024, 1, 16))
        self.assertEqual(r['dias_feriados'], 1)
        self.assertEqual(r['dias_fines_semana'], 2)

    def test_dos_feriados_extienden_vacation(self):
        # Jan 8(1) → Jan 9 feriado → Jan 10 feriado → Jan 11(2) → Jan 12(3)
        # → Sáb/Dom → Jan 15(4) → Jan 16(5) → retorno Jan 17
        feriados = {date(2024, 1, 9), date(2024, 1, 10)}
        r = self._run(date(2024, 1, 8), Decimal('5'), feriados=feriados)
        self.assertEqual(r['dias_feriados'], 2)
        self.assertEqual(r['fecha_retorno'], date(2024, 1, 17))

    def test_feriado_en_fin_de_semana_no_cuenta(self):
        # Si el feriado cae en sábado no incrementa el contador (el sáb ya era no hábil)
        feriados = {date(2024, 1, 13)}  # sábado
        r_sin = self._run(date(2024, 1, 8), Decimal('5'))
        r_con = self._run(date(2024, 1, 8), Decimal('5'), feriados=feriados)
        # El sáb ya era skip por fin de semana, el feriado no añade días extras
        self.assertEqual(r_sin['fecha_retorno'], r_con['fecha_retorno'])
        self.assertEqual(r_con['dias_feriados'], 0)

    # ── Días fraccionarios ─────────────────────────────────────────────────────

    def test_medio_dia_retorna_al_dia_siguiente(self):
        r = self._run(date(2024, 1, 8), Decimal('0.5'))
        # 0.5 hábiles: el lunes 8/1 cuenta 1 completo (0.5 < target no, sale)
        # Espera: habiles=1 > 0.5, retorno = 9/1
        self.assertEqual(r['fecha_retorno'], date(2024, 1, 9))


class TestCalcularGestionesPendientes(TestCase):
    """Asignación correcta de slots y gestiones elegibles."""

    def _hoy(self, s):
        return date.fromisoformat(s)

    def test_recien_ingresado_sin_elegibilidad(self):
        # Ingresó hace 6 meses, ninguna gestión con 1 año completo
        ingreso = date(2025, 1, 1)
        hoy     = date(2025, 6, 1)
        self.assertEqual(calcular_gestioneS_pendientes(ingreso, hoy), [])

    def test_exactamente_un_anio_slot_4(self):
        ingreso = date(2024, 6, 1)
        hoy     = date(2025, 6, 1)  # cumple 1 año hoy
        gs      = calcular_gestioneS_pendientes(ingreso, hoy)
        self.assertEqual(len(gs), 1)
        slot, anio, dias = gs[0]
        self.assertEqual(slot, 4)
        self.assertEqual(anio, 2025)
        self.assertEqual(dias, Decimal('15'))

    def test_cuatro_gestiones_slots_correctos(self):
        # 4 años completos → 4 gestiones, oldest en slot 4, newest en slot 1
        ingreso = date(2021, 6, 1)
        hoy     = date(2025, 6, 1)
        gs      = calcular_gestioneS_pendientes(ingreso, hoy)
        self.assertEqual(len(gs), 4)
        slots = [g[0] for g in gs]
        anios = [g[1] for g in gs]
        self.assertEqual(slots, [4, 3, 2, 1])
        self.assertEqual(anios, [2022, 2023, 2024, 2025])

    def test_diez_anios_da_30_dias(self):
        ingreso = date(2015, 6, 1)
        hoy     = date(2025, 6, 1)  # cumple 10 años
        gs      = calcular_gestioneS_pendientes(ingreso, hoy)
        # gestión 2025 debe tener 30 días (>= 10 años)
        gestiones_dict = {g[1]: g[2] for g in gs}
        self.assertEqual(gestiones_dict[2025], Decimal('30'))

    def test_limite_maximo_cuatro_gestiones(self):
        ingreso = date(2005, 1, 1)  # 20+ años
        hoy     = date(2025, 6, 1)
        gs      = calcular_gestioneS_pendientes(ingreso, hoy)
        self.assertLessEqual(len(gs), 4)

    def test_antes_del_aniversario_no_incluye_anio_actual(self):
        # Ingresó 15/06, hoy es 14/06 (día antes de aniversario)
        ingreso = date(2024, 6, 15)
        hoy     = date(2025, 6, 14)
        gs      = calcular_gestioneS_pendientes(ingreso, hoy)
        anios   = [g[1] for g in gs]
        self.assertNotIn(2025, anios)

    def test_anios_cinco_da_20_dias(self):
        ingreso = date(2020, 6, 1)
        hoy     = date(2025, 6, 1)  # 5 años exactos
        gs      = calcular_gestioneS_pendientes(ingreso, hoy)
        gestiones_dict = {g[1]: g[2] for g in gs}
        self.assertEqual(gestiones_dict.get(2025), Decimal('20'))


# ══════════════════════════════════════════════════════════════════════════════
#  Tope de gestiones activas (4→2) y evicción a días perdidos
# ══════════════════════════════════════════════════════════════════════════════

class TestAplicarLimiteGestionesActivas(TestCase):

    def _funcionario(self, ci='90000001'):
        _, f = hacer_usuario_y_funcionario(ci=ci, fecha_ingreso=date(2015, 1, 1))
        return f

    def test_tres_activas_evictona_la_mas_antigua_por_anio(self):
        gv = hacer_gestion(self._funcionario(), anio1=2023, dias1=Decimal('15'))
        gv.anio_gestion2 = 2024
        gv.dias_gestion2 = Decimal('15')
        gv.anio_gestion3 = 2025
        gv.dias_gestion3 = Decimal('20')

        evictadas = aplicar_limite_gestiones_activas(gv)

        self.assertEqual(len(evictadas), 1)
        self.assertEqual(evictadas[0]['anio'], 2023)
        self.assertIsNone(gv.anio_gestion1)
        self.assertEqual(gv.dias_gestion1, Decimal('0'))
        self.assertEqual(gv.dias_perdidos, Decimal('15'))
        self.assertEqual(gv.anio_gestion2, 2024)
        self.assertEqual(gv.anio_gestion3, 2025)

    def test_exactamente_dos_activas_no_evictona(self):
        gv = hacer_gestion(self._funcionario(), anio1=2024, dias1=Decimal('15'))
        gv.anio_gestion2 = 2025
        gv.dias_gestion2 = Decimal('15')

        evictadas = aplicar_limite_gestiones_activas(gv)

        self.assertEqual(evictadas, [])
        self.assertEqual(gv.dias_perdidos, Decimal('0'))

    def test_cero_o_una_activa_no_evictona(self):
        gv = GestionVacacion(cod_funcionario=self._funcionario())
        self.assertEqual(aplicar_limite_gestiones_activas(gv), [])

        gv2 = hacer_gestion(self._funcionario(ci='90000002'), anio1=2025, dias1=Decimal('15'))
        self.assertEqual(aplicar_limite_gestiones_activas(gv2), [])

    def test_evict_por_anio_no_por_slot(self):
        # slot 1 tiene el año más antiguo, slot 3 el más reciente: la evicción
        # debe usar el año real, no la posición del slot.
        gv = hacer_gestion(self._funcionario(), anio1=2022, dias1=Decimal('15'))
        gv.anio_gestion2 = 2024
        gv.dias_gestion2 = Decimal('15')
        gv.anio_gestion3 = 2023
        gv.dias_gestion3 = Decimal('20')

        evictadas = aplicar_limite_gestiones_activas(gv)

        self.assertEqual(len(evictadas), 1)
        self.assertEqual(evictadas[0]['anio'], 2022)
        self.assertEqual(evictadas[0]['slot'], 1)

    def test_idempotente(self):
        gv = hacer_gestion(self._funcionario(), anio1=2023, dias1=Decimal('15'))
        gv.anio_gestion2 = 2024
        gv.dias_gestion2 = Decimal('15')
        gv.anio_gestion3 = 2025
        gv.dias_gestion3 = Decimal('20')

        aplicar_limite_gestiones_activas(gv)
        perdidos_tras_primera = gv.dias_perdidos
        evictadas_segunda = aplicar_limite_gestiones_activas(gv)

        self.assertEqual(evictadas_segunda, [])
        self.assertEqual(gv.dias_perdidos, perdidos_tras_primera)

    def test_persistencia_en_bd(self):
        gv = hacer_gestion(self._funcionario(), anio1=2023, dias1=Decimal('15'))
        gv.anio_gestion2 = 2024
        gv.dias_gestion2 = Decimal('15')
        gv.anio_gestion3 = 2025
        gv.dias_gestion3 = Decimal('20')
        gv.save(update_fields=['anio_gestion2', 'dias_gestion2', 'anio_gestion3', 'dias_gestion3'])

        evictadas = aplicar_limite_gestiones_activas(gv)
        campos = {'dias_perdidos'}
        for ev in evictadas:
            campos.add(f"anio_gestion{ev['slot']}")
            campos.add(f"dias_gestion{ev['slot']}")
        gv.save(update_fields=list(campos))
        gv.refresh_from_db()

        self.assertEqual(gv.dias_perdidos, Decimal('15.0'))
        self.assertIsNone(gv.anio_gestion1)
        self.assertEqual(gv.dias_gestion1, Decimal('0.0'))
        self.assertEqual(gv.anio_gestion2, 2024)
        self.assertEqual(gv.anio_gestion3, 2025)
        self.assertEqual(gv.dias_adeudados, Decimal('35.0'))


# ══════════════════════════════════════════════════════════════════════════════
#  Tests de API — requieren DB (usa ManagedTestRunner de settings.py)
# ══════════════════════════════════════════════════════════════════════════════

class TestCalcularRetornoAPI(APITestCase):
    """POST /api/vacaciones/calcular-retorno/ — no requiere Funcionario."""

    def setUp(self):
        from django.contrib.auth.models import User
        self.user = User.objects.create_user('tester', password='pass')
        self.client.force_login(self.user)
        self.url = reverse('vac_calcular_retorno')

    def test_requiere_autenticacion(self):
        # El middleware ControlAccesoRoles intercepta antes que DRF y redirige
        # al login (302) a cualquier usuario no autenticado, incluidas las APIs.
        self.client.logout()
        r = self.client.post(self.url, {'fecha_salida': '2024-01-08', 'dias_solicitados': '5'})
        self.assertEqual(r.status_code, status.HTTP_302_FOUND)

    def test_datos_incompletos_devuelve_400(self):
        r = self.client.post(self.url, {'fecha_salida': '2024-01-08'})
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_fecha_invalida_devuelve_400(self):
        r = self.client.post(self.url, {'fecha_salida': 'no-es-fecha', 'dias_solicitados': '5'})
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_dias_cero_devuelve_400(self):
        r = self.client.post(self.url, {'fecha_salida': '2024-01-08', 'dias_solicitados': '0'})
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cinco_dias_habiles_desde_lunes(self):
        r = self.client.post(self.url, {
            'fecha_salida': '2024-01-08',
            'dias_solicitados': '5',
        })
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        data = r.json()
        self.assertEqual(data['fecha_retorno'], '2024-01-13')
        self.assertEqual(data['dias_fines_semana'], 0)
        self.assertEqual(data['dias_feriados'], 0)

    def test_cinco_dias_con_feriado_registrado(self):
        Feriado.objects.create(
            fecha=date(2024, 1, 10),
            descripcion='Feriado de prueba',
            tipo='Nacional',
        )
        r = self.client.post(self.url, {
            'fecha_salida': '2024-01-08',
            'dias_solicitados': '5',
        })
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        data = r.json()
        self.assertEqual(data['dias_feriados'], 1)
        self.assertGreater(
            date.fromisoformat(data['fecha_retorno']),
            date(2024, 1, 13),
        )

    def test_respuesta_incluye_fecha_conclusion(self):
        r = self.client.post(self.url, {
            'fecha_salida': '2024-01-08',
            'dias_solicitados': '5',
        })
        data = r.json()
        retorno    = date.fromisoformat(data['fecha_retorno'])
        conclusion = date.fromisoformat(data['fecha_conclusion'])
        from datetime import timedelta
        self.assertEqual(conclusion, retorno - timedelta(days=1))


class TestDatosFormularioAPI(APITestCase):
    """GET /api/vacaciones/datos/ — requiere Funcionario activo + GestionVacacion."""

    def setUp(self):
        self.user, self.func = hacer_usuario_y_funcionario(
            ci='11111111',
            nombre='Ana',
            fecha_ingreso=date(2021, 1, 1),
        )
        hacer_cargo(self.func)
        self.gv = hacer_gestion(self.func, anio1=2024, dias1=Decimal('15'))
        self.client.force_login(self.user)
        self.url = reverse('vac_datos')

    def test_requiere_autenticacion(self):
        # El middleware ControlAccesoRoles intercepta antes que DRF y redirige
        # al login (302) a cualquier usuario no autenticado, incluidas las APIs.
        self.client.logout()
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, status.HTTP_302_FOUND)

    def test_devuelve_datos_del_funcionario(self):
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        data = r.json()
        self.assertEqual(data['ci'], '11111111')
        self.assertIn('saldos', data)
        self.assertIn('gestiones', data['saldos'])

    def test_puede_solicitar_con_saldo(self):
        r = self.client.get(self.url)
        data = r.json()
        # Tiene 1 año+ de ingreso y saldo > 0 → puede solicitar
        self.assertTrue(data['puede_solicitar'])

    def test_funcionario_inexistente_devuelve_404(self):
        from django.contrib.auth.models import User
        otro_user = User.objects.create_user('99999999', password='pass')
        self.client.force_login(otro_user)
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, status.HTTP_404_NOT_FOUND)


class TestCrearSolicitudAPI(APITestCase):
    """POST /api/vacaciones/crear/ — valida saldo y crea solicitud."""

    def setUp(self):
        self.user, self.func = hacer_usuario_y_funcionario(
            ci='22222222',
            nombre='Pedro',
            fecha_ingreso=date(2020, 1, 1),
        )
        hacer_cargo(self.func)
        self.gv = hacer_gestion(self.func, anio1=2024, dias1=Decimal('15'))

        # Crear un aprobador para que la solicitud quede PENDIENTE (no APROBADA)
        _, self.aprobador = hacer_usuario_y_funcionario(
            ci='22222223', nombre='Jefe', roles=['Jefe de Area']
        )
        JerarquiaAprobacion.objects.create(
            cod_funcionario=self.func,
            cod_aprobador=self.aprobador,
            nivel_aprobacion=1,
            activo=True,
        )

        self.client.force_login(self.user)
        self.url = reverse('vac_crear')

    def _payload_valido(self, dias='5'):
        # Fechas relativas a "hoy" para que el test no quede obsoleto con el paso del tiempo
        # (la vista rechaza fecha_salida en el pasado).
        salida  = date.today() + timedelta(days=30)
        retorno = salida + timedelta(days=7)
        return {
            'fecha_salida':   salida.isoformat(),
            'fecha_retorno':  retorno.isoformat(),
            'dias_solicitados': dias,
            'motivo_vacacion': 'Vacaciones anuales por descanso familiar',
        }

    def test_crear_solicitud_exitosa(self):
        r = self.client.post(self.url, self._payload_valido())
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertTrue(r.json()['ok'])
        self.assertTrue(SolicitudVacacion.objects.filter(cod_funcionario=self.func).exists())

    def test_saldo_insuficiente_devuelve_400(self):
        r = self.client.post(self.url, self._payload_valido(dias='30'))
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Saldo insuficiente', r.json()['error'])

    def test_motivo_muy_corto_devuelve_400(self):
        payload = self._payload_valido()
        payload['motivo_vacacion'] = 'Corto'
        r = self.client.post(self.url, payload)
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_no_doble_solicitud_pendiente(self):
        # Primera solicitud queda PENDIENTE_JEFE (hay jerarquía)
        self.client.post(self.url, self._payload_valido())
        # Segunda solicitud debe rechazarse
        r2 = self.client.post(self.url, self._payload_valido())
        self.assertEqual(r2.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('pendiente', r2.json()['error'])

    def test_sin_gestion_vacacion_devuelve_400(self):
        self.gv.delete()
        r = self.client.post(self.url, self._payload_valido())
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)


class TestMisSolicitudesAPI(APITestCase):
    """GET /api/vacaciones/mis-solicitudes/ — lista solicitudes del funcionario."""

    def setUp(self):
        self.user, self.func = hacer_usuario_y_funcionario(
            ci='33333333',
            nombre='Laura',
            fecha_ingreso=date(2019, 3, 1),
        )
        hacer_cargo(self.func)
        hacer_gestion(self.func, anio1=2024, dias1=Decimal('10'))
        self.client.force_login(self.user)
        self.url = reverse('vac_mis_solicitudes')

    def test_devuelve_lista_vacia_sin_solicitudes(self):
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        data = r.json()
        self.assertEqual(data['solicitudes'], [])
        self.assertEqual(data['resumen']['total'], 0)

    def test_devuelve_solicitud_creada(self):
        SolicitudVacacion.objects.create(
            cod_funcionario=self.func,
            fecha_salida=date(2025, 2, 3),
            fecha_retorno=date(2025, 2, 10),
            dias_solicitados=Decimal('5'),
            motivo_vacacion='Vacaciones anuales',
            estado='APROBADA',
        )
        r = self.client.get(self.url)
        data = r.json()
        self.assertEqual(data['resumen']['total'], 1)
        self.assertEqual(data['solicitudes'][0]['estado'], 'Aprobada')


class TestHistorialRRHHAPI(APITestCase):
    """GET /api/vacaciones/historial-rrhh/ — solo accesible con rol RRHH."""

    def setUp(self):
        self.user_rrhh, self.func_rrhh = hacer_usuario_y_funcionario(
            ci='44444444', nombre='Carlos', roles=['RRHH']
        )
        self.user_normal, _ = hacer_usuario_y_funcionario(
            ci='55555555', nombre='Normal'
        )
        self.url = reverse('vac_historial_rrhh')

    def test_sin_rol_rrhh_devuelve_403(self):
        self.client.force_login(self.user_normal)
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_con_rol_rrhh_devuelve_200(self):
        self.client.force_login(self.user_rrhh)
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        data = r.json()
        self.assertIn('solicitudes', data)
        self.assertIn('usuario', data)


class TestAcreditarGestionAPI(APITestCase):
    """POST /api/vacaciones/acreditar-gestion/ — tope de 2 gestiones activas."""

    def setUp(self):
        # Evita que el signal de auto-poblado (vacations/apps.py, dispara en el
        # primer request HTTP del proceso) toque los funcionarios de prueba.
        import vacations.apps as vacations_apps
        vacations_apps._primer_request_ejecutado = True

        self.user_rrhh, self.func_rrhh = hacer_usuario_y_funcionario(
            ci='66666666', nombre='RRHH-Test', roles=['RRHH']
        )
        self.user_normal, _ = hacer_usuario_y_funcionario(ci='77777777', nombre='Normal')
        self.url = reverse('vac_acreditar_gestion')

    def test_sin_rol_rrhh_devuelve_403(self):
        self.client.force_login(self.user_normal)
        r = self.client.post(self.url, {'cod_funcionario': 'F1', 'anio_gestion': 2023})
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_tercera_gestion_evictona_la_mas_antigua(self):
        f = hacer_funcionario(ci='88888888', nombre='Ana', fecha_ingreso=date(2015, 1, 1))
        gv = hacer_gestion(f, anio1=2023, dias1=Decimal('15'))
        gv.anio_gestion2 = 2024
        gv.dias_gestion2 = Decimal('15')
        gv.save(update_fields=['anio_gestion2', 'dias_gestion2'])

        self.client.force_login(self.user_rrhh)
        r = self.client.post(self.url, {'cod_funcionario': f.cod_funcionario, 'anio_gestion': 2025})

        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        data = r.json()
        self.assertEqual(len(data['gestiones_perdidas']), 1)
        self.assertEqual(data['gestiones_perdidas'][0]['anio'], 2023)

        gv.refresh_from_db()
        self.assertIsNone(gv.anio_gestion1)
        self.assertEqual(gv.dias_perdidos, Decimal('15.0'))
        self.assertEqual(gv.anio_gestion2, 2024)
        self.assertIn(2025, [gv.anio_gestion3, gv.anio_gestion4])

    def test_segunda_gestion_no_evictona(self):
        f = hacer_funcionario(ci='99999999', nombre='Beto', fecha_ingreso=date(2015, 1, 1))
        gv = hacer_gestion(f, anio1=2024, dias1=Decimal('15'))

        self.client.force_login(self.user_rrhh)
        r = self.client.post(self.url, {'cod_funcionario': f.cod_funcionario, 'anio_gestion': 2025})

        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        data = r.json()
        self.assertEqual(data['gestiones_perdidas'], [])

        gv.refresh_from_db()
        self.assertEqual(gv.dias_perdidos, Decimal('0.0'))
        self.assertEqual(gv.anio_gestion1, 2024)


class TestAlertaGestionesRiesgoAPI(APITestCase):
    """GET /api/vacaciones/alerta-gestiones-riesgo/ — funcionarios con 2
    gestiones activas y una nueva ya elegible pero sin acreditar todavía."""

    def setUp(self):
        import vacations.apps as vacations_apps
        vacations_apps._primer_request_ejecutado = True

        self.user_rrhh, self.func_rrhh = hacer_usuario_y_funcionario(
            ci='11111101', nombre='RRHH-Test', roles=['RRHH']
        )
        self.user_normal, _ = hacer_usuario_y_funcionario(ci='11111102', nombre='Normal')
        self.url = reverse('vac_alerta_gestiones_riesgo')

    def test_sin_rol_rrhh_devuelve_403(self):
        self.client.force_login(self.user_normal)
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_fecha_limite_ya_pasada_no_aparece(self):
        # Los días ya se perdieron: avisar no sirve de nada, así que la
        # alerta deja de mostrarlos.
        hoy = date.today()
        aniversario_pasado = max(hoy - timedelta(days=15), date(hoy.year, 1, 1))
        f = hacer_funcionario(
            ci='11111103', nombre='Carla',
            fecha_ingreso=date(2015, aniversario_pasado.month, aniversario_pasado.day),
        )
        gv = hacer_gestion(f, anio1=hoy.year - 2, dias1=Decimal('15'))
        gv.anio_gestion2 = hoy.year - 1
        gv.dias_gestion2 = Decimal('15')
        gv.save(update_fields=['anio_gestion2', 'dias_gestion2'])

        self.client.force_login(self.user_rrhh)
        r = self.client.get(self.url)

        self.assertEqual(r.status_code, status.HTTP_200_OK)
        cis = [row['ci'] for row in r.json()['funcionarios']]
        self.assertNotIn('11111103', cis)

    def test_funcionario_al_dia_no_aparece(self):
        f = hacer_funcionario(ci='11111104', nombre='Diego', fecha_ingreso=date(2015, 1, 1))
        gv = hacer_gestion(f, anio1=2025, dias1=Decimal('15'))
        gv.anio_gestion2 = 2026
        gv.dias_gestion2 = Decimal('15')
        gv.save(update_fields=['anio_gestion2', 'dias_gestion2'])

        self.client.force_login(self.user_rrhh)
        r = self.client.get(self.url)

        cis = [row['ci'] for row in r.json()['funcionarios']]
        self.assertNotIn('11111104', cis)

    def test_funcionario_bajo_el_tope_no_aparece(self):
        f = hacer_funcionario(ci='11111105', nombre='Elena', fecha_ingreso=date(2015, 1, 1))
        hacer_gestion(f, anio1=2026, dias1=Decimal('15'))

        self.client.force_login(self.user_rrhh)
        r = self.client.get(self.url)

        cis = [row['ci'] for row in r.json()['funcionarios']]
        self.assertNotIn('11111105', cis)

    def test_aniversario_dentro_de_un_mes_aparece_con_anticipo(self):
        # Hoy es 2026-07-02; aniversario 2026-07-20 cae dentro de la ventana
        # de 1 mes de anticipo, aunque todavía no llegó.
        hoy = date.today()
        aniversario_futuro = hoy + timedelta(days=18)
        f = hacer_funcionario(
            ci='11111106', nombre='Fabi',
            fecha_ingreso=date(2015, aniversario_futuro.month, aniversario_futuro.day),
        )
        gv = hacer_gestion(f, anio1=hoy.year - 2, dias1=Decimal('15'))
        gv.anio_gestion2 = hoy.year - 1
        gv.dias_gestion2 = Decimal('15')
        gv.save(update_fields=['anio_gestion2', 'dias_gestion2'])

        self.client.force_login(self.user_rrhh)
        r = self.client.get(self.url)

        cis = [row['ci'] for row in r.json()['funcionarios']]
        self.assertIn('11111106', cis)
        fila = next(row for row in r.json()['funcionarios'] if row['ci'] == '11111106')
        self.assertEqual(fila['fecha_limite'], aniversario_futuro.strftime('%d/%m/%Y'))
        self.assertEqual(fila['anio_en_riesgo'], hoy.year - 2)  # la gestión más antigua
        self.assertEqual(fila['dias'], 15.0)

    def test_aniversario_fuera_de_la_ventana_de_un_mes_no_aparece(self):
        # Aniversario a 60 días: fuera de la ventana de anticipo de 1 mes.
        hoy = date.today()
        aniversario_lejano = hoy + timedelta(days=60)
        f = hacer_funcionario(
            ci='11111107', nombre='Gabo',
            fecha_ingreso=date(2015, aniversario_lejano.month, aniversario_lejano.day),
        )
        gv = hacer_gestion(f, anio1=hoy.year - 2, dias1=Decimal('15'))
        gv.anio_gestion2 = hoy.year - 1
        gv.dias_gestion2 = Decimal('15')
        gv.save(update_fields=['anio_gestion2', 'dias_gestion2'])

        self.client.force_login(self.user_rrhh)
        r = self.client.get(self.url)

        cis = [row['ci'] for row in r.json()['funcionarios']]
        self.assertNotIn('11111107', cis)


class TestAlertaPoblarHoyAPI(APITestCase):
    """GET /api/vacaciones/alerta-poblar-hoy/ — aniversarios ya cumplidos
    (ajustados a día hábil) cuya gestión aún no se acreditó."""

    def setUp(self):
        import vacations.apps as vacations_apps
        vacations_apps._primer_request_ejecutado = True

        self.user_rrhh, self.func_rrhh = hacer_usuario_y_funcionario(
            ci='11111201', nombre='RRHH-Test2', roles=['RRHH']
        )
        self.user_normal, _ = hacer_usuario_y_funcionario(ci='11111202', nombre='Normal2')
        self.url = reverse('vac_alerta_poblar_hoy')

    def test_sin_rol_rrhh_devuelve_403(self):
        self.client.force_login(self.user_normal)
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_aniversario_hoy_sin_acreditar_aparece(self):
        hoy = date.today()
        f = hacer_funcionario(
            ci='11111203', nombre='Flor',
            fecha_ingreso=date(hoy.year - 5, hoy.month, hoy.day),
        )
        hacer_gestion(f, anio1=hoy.year - 1, dias1=Decimal('15'))

        self.client.force_login(self.user_rrhh)
        r = self.client.get(self.url)

        self.assertEqual(r.status_code, status.HTTP_200_OK)
        cis = [row['ci'] for row in r.json()['funcionarios']]
        self.assertIn('11111203', cis)
        fila = next(row for row in r.json()['funcionarios'] if row['ci'] == '11111203')
        self.assertEqual(fila['anio_pendiente'], hoy.year)
        self.assertEqual(fila['aniversario'], hoy.strftime('%d/%m/%Y'))

    def test_funcionario_ya_acreditado_no_aparece(self):
        hoy = date.today()
        f = hacer_funcionario(
            ci='11111205', nombre='Hilda',
            fecha_ingreso=date(hoy.year - 5, hoy.month, hoy.day),
        )
        hacer_gestion(f, anio1=hoy.year, dias1=Decimal('15'))

        self.client.force_login(self.user_rrhh)
        r = self.client.get(self.url)

        cis = [row['ci'] for row in r.json()['funcionarios']]
        self.assertNotIn('11111205', cis)

    def test_aniversario_futuro_no_aparece(self):
        hoy = date.today()
        futuro = hoy + timedelta(days=10)
        f = hacer_funcionario(
            ci='11111206', nombre='Ivan',
            fecha_ingreso=date(hoy.year - 5, futuro.month, futuro.day),
        )
        hacer_gestion(f, anio1=hoy.year - 1, dias1=Decimal('15'))

        self.client.force_login(self.user_rrhh)
        r = self.client.get(self.url)

        cis = [row['ci'] for row in r.json()['funcionarios']]
        self.assertNotIn('11111206', cis)

    def test_aniversario_en_feriado_ayer_aparece_hoy_ajustado(self):
        hoy   = date.today()
        ayer  = hoy - timedelta(days=1)
        Feriado.objects.create(fecha=ayer, descripcion='Feriado de prueba', tipo='Nacional')

        f = hacer_funcionario(
            ci='11111207', nombre='Julia',
            fecha_ingreso=date(hoy.year - 5, ayer.month, ayer.day),
        )
        hacer_gestion(f, anio1=hoy.year - 1, dias1=Decimal('15'))

        self.client.force_login(self.user_rrhh)
        r = self.client.get(self.url)

        fila = next((row for row in r.json()['funcionarios'] if row['ci'] == '11111207'), None)
        self.assertIsNotNone(fila)
        self.assertEqual(fila['aniversario'], ayer.strftime('%d/%m/%Y'))


class ResincronizarGestionesTests(TestCase):
    """Corregir la fecha de ingreso debe reajustar años y saldos sin devolver
    los días ya consumidos."""

    def test_reajusta_anios_y_conserva_dias_consumidos(self):
        from vacations.models import GestionVacacion
        from vacations.utils import poblar_gestion_vacacion, resincronizar_gestiones

        vieja = date(2015, 1, 10)
        f = hacer_funcionario(ci='12341234', nombre='Yaskara', fecha_ingreso=vieja)
        poblar_gestion_vacacion(f)

        gv = GestionVacacion.objects.get(cod_funcionario=f)
        slot_reciente = next(i for i in range(1, 5) if getattr(gv, f'anio_gestion{i}') is not None)
        anio_reciente = getattr(gv, f'anio_gestion{slot_reciente}')
        asignados     = getattr(gv, f'dias_gestion{slot_reciente}')

        # El funcionario ya tomó 5 días de esa gestión.
        setattr(gv, f'dias_gestion{slot_reciente}', asignados - Decimal('5'))
        gv.save()

        # Se corrige la fecha de ingreso a un año después.
        f.fecha_ingreso = date(2016, 1, 10)
        f.save(update_fields=['fecha_ingreso'])
        self.assertTrue(resincronizar_gestiones(f, vieja))

        gv.refresh_from_db()
        anios_bd = {getattr(gv, f'anio_gestion{i}') for i in range(1, 5)} - {None}
        # Solo sobreviven las 2 gestiones activas más recientes (LIMITE_GESTIONES_ACTIVAS).
        esperados = set(sorted(a for _, a, _ in calcular_gestioneS_pendientes(f.fecha_ingreso))[-2:])
        self.assertEqual(anios_bd, esperados)

        # El año que sobrevive conserva el descuento de los 5 días tomados.
        if anio_reciente in anios_bd:
            slot = next(i for i in range(1, 5) if getattr(gv, f'anio_gestion{i}') == anio_reciente)
            nuevo_total = dias_por_antiguedad(
                calcular_anios_antiguedad(f.fecha_ingreso, date(anio_reciente, 12, 31))
            )
            self.assertEqual(getattr(gv, f'dias_gestion{slot}'), nuevo_total - Decimal('5'))

    def test_sin_cambio_de_fecha_no_hace_nada(self):
        from vacations.utils import resincronizar_gestiones

        f = hacer_funcionario(ci='43214321', nombre='Luis', fecha_ingreso=date(2018, 5, 1))
        self.assertFalse(resincronizar_gestiones(f, date(2018, 5, 1)))


# ══════════════════════════════════════════════════════════════════════════════
#  Acuerdos de vacación: gestiones protegidas contra la evicción por tope
# ══════════════════════════════════════════════════════════════════════════════

from django.db import transaction
from vacations.models import AcuerdoVacacion, AcuerdoVacacionFuncionario, AprobacionSolicitud
from vacations.utils import anios_protegidos, poblar_gestion_vacacion, siguiente_correlativo


def _proteger(funcionario, anio, fecha_hasta, estado='VIGENTE', tipo='COLECTIVO', **kw):
    ac = AcuerdoVacacion.objects.create(
        tipo=tipo, motivo='Emergencia sanitaria',
        fecha_acuerdo=date.today(), fecha_hasta=fecha_hasta, estado=estado, **kw,
    )
    AcuerdoVacacionFuncionario.objects.create(id_acuerdo=ac, cod_funcionario=funcionario, anio_gestion=anio,
                                              dias_protegidos=Decimal('15'))
    return ac


class TestAcuerdosProteccion(TestCase):

    def _gv_tres_gestiones(self, ci='91000001'):
        f = hacer_funcionario(ci=ci, fecha_ingreso=date(2015, 1, 1))
        gv = hacer_gestion(f, anio1=2023, dias1=Decimal('15'))
        gv.anio_gestion2, gv.dias_gestion2 = 2024, Decimal('15')
        gv.anio_gestion3, gv.dias_gestion3 = 2025, Decimal('20')
        return f, gv

    def test_gestion_protegida_vigente_no_se_evicta(self):
        f, gv = self._gv_tres_gestiones()
        _proteger(f, 2023, date.today() + timedelta(days=30))
        self.assertEqual(aplicar_limite_gestiones_activas(gv), [])
        self.assertEqual(gv.anio_gestion1, 2023)
        self.assertEqual(gv.dias_perdidos, Decimal('0'))

    def test_acuerdo_vencido_anulado_o_modificado_ya_no_protege(self):
        f, gv = self._gv_tres_gestiones()
        _proteger(f, 2023, date.today() - timedelta(days=1))
        _proteger(f, 2023, date.today() + timedelta(days=30), estado='ANULADO')
        _proteger(f, 2023, date.today() + timedelta(days=30), estado='MODIFICADO')
        evictadas = aplicar_limite_gestiones_activas(gv)
        self.assertEqual([e['anio'] for e in evictadas], [2023])
        self.assertEqual(gv.dias_perdidos, Decimal('15'))

    def test_poblar_no_reacredita_anios_ya_evictados(self):
        # Regresión: con las 2 gestiones más recientes ya registradas, el
        # poblado diario re-acreditaba los años viejos y los volvía a evictar,
        # sumando a dias_perdidos en cada pasada.
        f = hacer_funcionario(ci='91000002', fecha_ingreso=date(2012, 1, 9))
        recientes = calcular_gestioneS_pendientes(f.fecha_ingreso)[-2:]
        gv = GestionVacacion(cod_funcionario=f, dias_perdidos=Decimal('40'))
        for idx, (_, anio, dias) in enumerate(reversed(recientes), start=1):
            setattr(gv, f'anio_gestion{idx}', anio)
            setattr(gv, f'dias_gestion{idx}', dias)
        gv.save()

        for _ in range(2):
            self.assertEqual(poblar_gestion_vacacion(f)['acreditadas'], 0)
        gv.refresh_from_db()
        self.assertEqual(gv.dias_perdidos, Decimal('40'))


class TestNumeracionAcuerdo(TestCase):

    def _crear(self, anio, correlativo):
        return AcuerdoVacacion.objects.create(
            tipo='COLECTIVO', anio_nro=anio, correlativo=correlativo, motivo='Emergencia',
            fecha_acuerdo=date.today(), fecha_hasta=date.today() + timedelta(days=30),
        )

    def test_empieza_en_01_sigue_y_se_reinicia_por_anio(self):
        with transaction.atomic():
            self.assertEqual(siguiente_correlativo(2026), 1)
        self._crear(2026, 1)
        self._crear(2026, 2)
        self._crear(2025, 7)
        with transaction.atomic():
            self.assertEqual(siguiente_correlativo(2026), 3)
            self.assertEqual(siguiente_correlativo(2027), 1)

    def test_formato(self):
        self.assertEqual(self._crear(2026, 1).nro_acuerdo, 'RA-01/2026')
        self.assertEqual(self._crear(2026, 100).nro_acuerdo, 'RA-100/2026')
        self.assertIsNone(AcuerdoVacacion(tipo='RECHAZO').nro_acuerdo)


class TestRechazoCercaDelVencimiento(APITestCase):

    def setUp(self):
        import vacations.apps as vacations_apps
        vacations_apps._primer_request_ejecutado = True

        self.user_jefe, self.jefe = hacer_usuario_y_funcionario(
            ci='92000001', nombre='Jefe', roles=['Jefe de Area']
        )

    def _escenario(self, ci, dias_hasta_limite):
        """Funcionario con 2 gestiones activas cuya fecha límite cae en N días."""
        d = date.today() + timedelta(days=dias_hasta_limite)
        f = hacer_funcionario(ci=ci, fecha_ingreso=date(2010, d.month, min(d.day, 28)))
        anio_viejo = d.year - 2
        # Solicitud de 5 días ya descontada de la gestión más antigua (15 → 10).
        gv = hacer_gestion(f, anio1=anio_viejo + 1, dias1=Decimal('30'))
        gv.anio_gestion2, gv.dias_gestion2 = anio_viejo, Decimal('10')
        gv.save(update_fields=['anio_gestion2', 'dias_gestion2'])
        JerarquiaAprobacion.objects.create(
            cod_funcionario=f, cod_aprobador=self.jefe, nivel_aprobacion=1, activo=True,
        )
        sol = SolicitudVacacion.objects.create(
            cod_funcionario=f, fecha_salida=date.today() + timedelta(days=5),
            fecha_retorno=date.today() + timedelta(days=12), dias_solicitados=Decimal('5'),
        )
        return f, sol, anio_viejo

    def _rechazar(self, sol):
        self.client.force_login(self.user_jefe)
        return self.client.post(reverse('vac_decision'), {
            'id_formulario': sol.id_formulario, 'decision': 'RECHAZADO',
            'observacion': 'Falta de personal en el servicio',
        })

    def test_rechazo_cerca_del_vencimiento_protege_y_repone(self):
        f, sol, anio_viejo = self._escenario('92000002', dias_hasta_limite=30)
        r = self._rechazar(sol)
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.content)

        gv = GestionVacacion.objects.get(cod_funcionario=f)
        self.assertEqual(gv.dias_gestion2, Decimal('15'))   # repuesto en la más antigua
        self.assertEqual(gv.dias_negados, Decimal('5'))

        ac = AcuerdoVacacion.objects.get(id_formulario=sol)
        self.assertEqual(ac.tipo, 'RECHAZO')
        self.assertIsNone(ac.nro_acuerdo)
        self.assertGreater(ac.fecha_hasta, date.today() + timedelta(days=30))
        self.assertEqual(anios_protegidos(f.cod_funcionario), {anio_viejo})

    def test_rechazo_fuera_del_ultimo_mes_no_crea_acuerdo(self):
        for ci, dias in (('92000003', 45), ('92000004', 200)):
            f, sol, _ = self._escenario(ci, dias_hasta_limite=dias)
            r = self._rechazar(sol)
            self.assertEqual(r.status_code, status.HTTP_200_OK, r.content)
            self.assertFalse(AcuerdoVacacion.objects.filter(id_formulario=sol).exists())
            gv = GestionVacacion.objects.get(cod_funcionario=f)
            self.assertEqual(gv.dias_gestion2, Decimal('15'))
            self.assertEqual(gv.dias_negados, Decimal('5'))


class TestAcuerdosAPI(APITestCase):

    def setUp(self):
        import vacations.apps as vacations_apps
        vacations_apps._primer_request_ejecutado = True
        self.user_rrhh, _ = hacer_usuario_y_funcionario(ci='93000001', nombre='RRHH', roles=['RRHH'])
        self.user_normal, _ = hacer_usuario_y_funcionario(ci='93000002', nombre='Normal')
        self.user_f, self.f = hacer_usuario_y_funcionario(ci='93000003', fecha_ingreso=date(2015, 1, 1))
        self.f2 = hacer_funcionario(ci='93000004', fecha_ingreso=date(2015, 1, 1))
        self.gg = hacer_funcionario(ci='93000005', nombre='Gerente', tipo='GERENTE GENERAL')
        for func in (self.f, self.f2):
            gv = hacer_gestion(func, anio1=2025, dias1=Decimal('20'))
            gv.anio_gestion2, gv.dias_gestion2 = 2024, Decimal('18')
            gv.save(update_fields=['anio_gestion2', 'dias_gestion2'])
        self.url = reverse('vac_acuerdos')
        self.client.force_login(self.user_rrhh)

    def _payload(self, funcionarios=None, **kw):
        return {
            'tipo': 'COLECTIVO', 'motivo': 'Emergencia Sanitaria',
            'fecha_acuerdo': date.today().isoformat(),
            'fecha_hasta': (date.today() + timedelta(days=365)).isoformat(),
            'autorizado_por': self.gg.cod_funcionario,
            'funcionarios': funcionarios or [{'cod': self.f.cod_funcionario, 'anios': [2024, 2025]}],
            **kw,
        }

    def _crear(self, **kw):
        r = self.client.post(self.url, self._payload(**kw), format='json')
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.content)
        return r.json()

    def test_sin_rol_rrhh_403(self):
        self.client.force_login(self.user_normal)
        r = self.client.post(self.url, self._payload(), format='json')
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_crear_numera_y_toma_dias_del_sistema(self):
        anio = date.today().year
        data = self._crear(funcionarios=[{'cod': self.f.cod_funcionario, 'anios': [2024, 2025], 'dias': 99}])
        self.assertEqual(data['nro'], f'RA-01/{anio}')
        self.assertEqual(anios_protegidos(self.f.cod_funcionario), {2024, 2025})
        ac = AcuerdoVacacion.objects.get(id_acuerdo=data['id'])
        self.assertEqual(ac.estado, 'VIGENTE')
        self.assertEqual(ac.registrado_por.ci_id, '93000001')
        dias = dict(ac.afectados.values_list('anio_gestion', 'dias_protegidos'))
        self.assertEqual(dias, {2024: Decimal('18'), 2025: Decimal('20')})

        data2 = self._crear(tipo='INDIVIDUAL', funcionarios=[{'cod': self.f2.cod_funcionario, 'anios': [2025]}])
        self.assertEqual(data2['nro'], f'RA-02/{anio}')

    def test_validaciones(self):
        casos = [
            self._payload(tipo='INDIVIDUAL', funcionarios=[
                {'cod': self.f.cod_funcionario, 'anios': [2025]},
                {'cod': self.f2.cod_funcionario, 'anios': [2025]},
            ]),
            self._payload(funcionarios=[{'cod': self.f.cod_funcionario, 'anios': [2019]}]),
            self._payload(funcionarios=[{'cod': self.f.cod_funcionario, 'anios': []}]),
            self._payload(autorizado_por=self.f2.cod_funcionario),
            self._payload(fecha_hasta=date.today().isoformat()),
            self._payload(tipo='RECHAZO'),
        ]
        for payload in casos:
            r = self.client.post(self.url, payload, format='json')
            self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST, payload)
        self.assertFalse(AcuerdoVacacion.objects.exists())

    def test_gestion_ya_protegida_no_se_repite(self):
        self._crear()
        r = self.client.post(self.url, self._payload(tipo='INDIVIDUAL'), format='json')
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_vincular_a_colectivo_reutiliza_numero(self):
        data = self._crear()
        r = self.client.post(self.url, {
            'vincular_id': data['id'], 'motivo': 'ignorado',
            'funcionarios': [{'cod': self.f2.cod_funcionario, 'anios': [2024]}],
        }, format='json')
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.content)
        self.assertEqual((r.json()['id'], r.json()['nro']), (data['id'], data['nro']))
        self.assertEqual(AcuerdoVacacion.objects.count(), 1)
        self.assertEqual(anios_protegidos(self.f2.cod_funcionario), {2024})

        r = self.client.post(self.url, {
            'vincular_id': data['id'], 'funcionarios': [{'cod': self.f.cod_funcionario, 'anios': [2024]}],
        }, format='json')
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_no_vincula_a_anulado(self):
        data = self._crear()
        AcuerdoVacacion.objects.filter(id_acuerdo=data['id']).update(estado='ANULADO')
        r = self.client.post(self.url, {
            'vincular_id': data['id'], 'funcionarios': [{'cod': self.f2.cod_funcionario, 'anios': [2024]}],
        }, format='json')
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_editar_conserva_numero(self):
        original = self._crear()
        editado = self._crear(modifica_id=original['id'], motivo='Emergencia Sanitaria ampliada')
        self.assertEqual((editado['id'], editado['nro']), (original['id'], original['nro']))
        ac = AcuerdoVacacion.objects.get(id_acuerdo=original['id'])
        self.assertEqual((ac.estado, ac.motivo), ('VIGENTE', 'Emergencia Sanitaria ampliada'))
        self.assertEqual(AcuerdoVacacion.objects.count(), 1)
        self.assertEqual(anios_protegidos(self.f.cod_funcionario), {2024, 2025})

    def test_anular_desprotege_y_aplica_tope(self):
        gv = GestionVacacion.objects.get(cod_funcionario=self.f)
        gv.anio_gestion3, gv.dias_gestion3 = 2023, Decimal('15')
        gv.save(update_fields=['anio_gestion3', 'dias_gestion3'])
        data = self._crear(funcionarios=[{'cod': self.f.cod_funcionario, 'anios': [2023]}])

        url = reverse('vac_acuerdo_anular', args=[data['id']])
        self.assertEqual(self.client.post(url, {'motivo': 'corto'}).status_code, status.HTTP_400_BAD_REQUEST)
        r = self.client.post(url, {'motivo': 'Se levantó la emergencia sanitaria'})
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.content)

        ac = AcuerdoVacacion.objects.get(id_acuerdo=data['id'])
        self.assertEqual(ac.estado, 'ANULADO')
        self.assertIsNotNone(ac.fecha_anulacion)
        self.assertEqual(anios_protegidos(self.f.cod_funcionario), set())
        gv.refresh_from_db()
        self.assertIsNone(gv.anio_gestion3)
        self.assertEqual(gv.dias_perdidos, Decimal('15'))
        self.assertEqual(self.client.post(url, {'motivo': 'Se levantó la emergencia'}).status_code,
                         status.HTTP_404_NOT_FOUND)

    def test_listado_incluye_gestiones_y_gerentes(self):
        data = self._crear()
        r = self.client.get(self.url).json()
        self.assertTrue(r['acuerdos'][0]['vigente'])
        self.assertEqual(r['gerentes'][0]['cod'], self.gg.cod_funcionario)
        func = {x['cod']: x for x in r['funcionarios']}
        self.assertEqual(
            [(g['anio'], g['protegida_por']) for g in func[self.f.cod_funcionario]['gestiones']],
            [(2024, data['id']), (2025, data['id'])],
        )

    def test_constancia_pdf(self):
        data = self._crear()
        url = reverse('vac_acuerdo_constancia', args=[data['id'], self.f.cod_funcionario])
        r = self.client.get(url)
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(r['Content-Type'], 'application/pdf')
        self.assertTrue(r.content.startswith(b'%PDF'))

        self.client.force_login(self.user_f)
        self.assertEqual(self.client.get(url).status_code, status.HTTP_200_OK)
        self.client.force_login(self.user_normal)
        self.assertEqual(self.client.get(url).status_code, status.HTTP_403_FORBIDDEN)

    def test_datos_formulario_contenedores(self):
        self.client.force_login(self.user_f)
        r = self.client.get(reverse('vac_datos')).json()
        self.assertEqual((r['acuerdos_protegidos'], r['rechazos_reprogramar']), ([], []))

        self.client.force_login(self.user_rrhh)
        data = self._crear(funcionarios=[{'cod': self.f.cod_funcionario, 'anios': [2025]}])
        sol = SolicitudVacacion.objects.create(
            cod_funcionario=self.f, fecha_salida=date.today(), fecha_retorno=date.today(),
            dias_solicitados=Decimal('1'), estado='RECHAZADA',
        )
        AprobacionSolicitud.objects.create(id_formulario=sol, cod_aprobador=self.gg, nivel=1,
                                           decision='RECHAZADO', observacion='Falta de personal')
        _proteger(self.f, 2024, date.today() + timedelta(days=90), tipo='RECHAZO', id_formulario=sol)

        self.client.force_login(self.user_f)
        r = self.client.get(reverse('vac_datos')).json()
        self.assertEqual([(a['nro'], a['anio'], a['dias']) for a in r['acuerdos_protegidos']],
                         [(data['nro'], 2025, 20.0)])
        self.assertEqual([(x['anio'], x['motivo']) for x in r['rechazos_reprogramar']],
                         [(2024, 'Falta de personal')])
