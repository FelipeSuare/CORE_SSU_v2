from datetime import date

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from django.test import TestCase

from core.models import Feriado
from core.test_utils import hacer_usuario_y_funcionario


class TestFeriadosListAPI(APITestCase):
    """GET /api/core/feriados/ — lista con filtros."""

    def setUp(self):
        self.user, _ = hacer_usuario_y_funcionario(ci='rrhh_test', nombre='RRHH Test')
        self.client.force_login(self.user)
        self.url = reverse('feriados_lista')

        Feriado.objects.bulk_create([
            Feriado(fecha=date(2024, 1, 1),  descripcion='Año Nuevo',       tipo='Nacional'),
            Feriado(fecha=date(2024, 5, 1),  descripcion='Día del Trabajo',  tipo='Nacional'),
            Feriado(fecha=date(2024, 7, 16), descripcion='Fiesta Local',     tipo='Departamental'),
            Feriado(fecha=date(2025, 1, 1),  descripcion='Año Nuevo 2025',   tipo='Nacional'),
        ])

    def test_requiere_autenticacion(self):
        # El middleware ControlAccesoRoles intercepta antes que DRF y redirige
        # al login (302) a cualquier usuario no autenticado, incluidas las APIs.
        self.client.logout()
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, status.HTTP_302_FOUND)

    def test_lista_todos_los_feriados(self):
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(len(r.json()['feriados']), 4)

    def test_filtro_por_anio(self):
        r = self.client.get(self.url, {'anio': '2024'})
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        feriados = r.json()['feriados']
        self.assertEqual(len(feriados), 3)
        for f in feriados:
            self.assertTrue(f['fecha'].startswith('2024'))

    def test_filtro_por_tipo(self):
        r = self.client.get(self.url, {'tipo': 'Departamental'})
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        feriados = r.json()['feriados']
        self.assertEqual(len(feriados), 1)
        self.assertEqual(feriados[0]['tipo'], 'Departamental')

    def test_filtro_combinado_anio_y_tipo(self):
        r = self.client.get(self.url, {'anio': '2024', 'tipo': 'Nacional'})
        feriados = r.json()['feriados']
        self.assertEqual(len(feriados), 2)

    def test_estructura_de_respuesta(self):
        r = self.client.get(self.url)
        f = r.json()['feriados'][0]
        self.assertIn('id', f)
        self.assertIn('fecha', f)
        self.assertIn('descripcion', f)
        self.assertIn('tipo', f)


class TestFeriadosCreateAPI(APITestCase):
    """POST /api/core/feriados/agregar/ — creación con validación (requiere rol RRHH)."""

    def setUp(self):
        self.user, _ = hacer_usuario_y_funcionario(
            ci='rrhh_create', nombre='RRHH Create', roles=['RRHH']
        )
        self.client.force_login(self.user)
        self.url = reverse('feriados_agregar')

    def _payload(self, fecha='2024-12-25', descripcion='Navidad', tipo='Nacional'):
        return {'fecha': fecha, 'descripcion': descripcion, 'tipo': tipo}

    def test_crea_feriado_exitosamente(self):
        r = self.client.post(self.url, self._payload())
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        data = r.json()
        self.assertTrue(data['ok'])
        self.assertTrue(Feriado.objects.filter(fecha=date(2024, 12, 25)).exists())

    def test_fecha_duplicada_devuelve_400(self):
        self.client.post(self.url, self._payload())
        r2 = self.client.post(self.url, self._payload())
        self.assertEqual(r2.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', r2.json())

    def test_fecha_invalida_devuelve_400(self):
        r = self.client.post(self.url, self._payload(fecha='no-es-fecha'))
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_tipo_invalido_devuelve_400(self):
        r = self.client.post(self.url, self._payload(tipo='TipoInventado'))
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_descripcion_vacia_devuelve_400(self):
        r = self.client.post(self.url, self._payload(descripcion=''))
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_tipos_validos_aceptados(self):
        tipos = ['Internacional', 'Nacional', 'Departamental', 'Municipal', 'Institucional']
        for i, tipo in enumerate(tipos):
            r = self.client.post(self.url, self._payload(
                fecha=f'2024-{i+1:02d}-15', tipo=tipo
            ))
            self.assertEqual(r.status_code, status.HTTP_201_CREATED, f'tipo={tipo} rechazado')


class TestFeriadoEditAPI(APITestCase):
    """POST /api/core/feriados/<id>/editar/ — edición (requiere rol RRHH)."""

    def setUp(self):
        self.user, _ = hacer_usuario_y_funcionario(
            ci='rrhh_edit', nombre='RRHH Edit', roles=['RRHH']
        )
        self.client.force_login(self.user)
        self.feriado = Feriado.objects.create(
            fecha=date(2024, 11, 2), descripcion='Día de Difuntos', tipo='Nacional'
        )
        self.url = reverse('feriados_editar', kwargs={'id_feriado': self.feriado.id_feriado})

    def test_edita_descripcion(self):
        r = self.client.post(self.url, {
            'fecha': '2024-11-02',
            'descripcion': 'Todos Santos actualizado',
            'tipo': 'Nacional',
        })
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.feriado.refresh_from_db()
        self.assertEqual(self.feriado.descripcion, 'Todos Santos actualizado')

    def test_fecha_ya_usada_por_otro_feriado_devuelve_400(self):
        Feriado.objects.create(fecha=date(2024, 8, 6), descripcion='Otro', tipo='Nacional')
        r = self.client.post(self.url, {
            'fecha': '2024-08-06',
            'descripcion': 'Cambio de fecha',
            'tipo': 'Nacional',
        })
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_feriado_inexistente_devuelve_404(self):
        url = reverse('feriados_editar', kwargs={'id_feriado': 99999})
        r = self.client.post(url, {
            'fecha': '2024-11-02',
            'descripcion': 'X',
            'tipo': 'Nacional',
        })
        self.assertEqual(r.status_code, status.HTTP_404_NOT_FOUND)


class TestFeriadoDeleteAPI(APITestCase):
    """POST /api/core/feriados/<id>/eliminar/ — baja (requiere rol RRHH)."""

    def setUp(self):
        self.user, _ = hacer_usuario_y_funcionario(
            ci='rrhh_del', nombre='RRHH Del', roles=['RRHH']
        )
        self.client.force_login(self.user)
        self.feriado = Feriado.objects.create(
            fecha=date(2024, 9, 15), descripcion='Para eliminar', tipo='Institucional'
        )
        self.url = reverse('feriados_eliminar', kwargs={'id_feriado': self.feriado.id_feriado})

    def test_elimina_feriado(self):
        r = self.client.post(self.url)
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertFalse(Feriado.objects.filter(pk=self.feriado.pk).exists())

    def test_inexistente_devuelve_404(self):
        url = reverse('feriados_eliminar', kwargs={'id_feriado': 99999})
        r = self.client.post(url)
        self.assertEqual(r.status_code, status.HTTP_404_NOT_FOUND)
