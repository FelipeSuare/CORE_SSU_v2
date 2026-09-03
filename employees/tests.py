import json
from datetime import date

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from core.test_utils import hacer_usuario_y_funcionario, hacer_cargo, hacer_unidad
from employees.models import Funcionario, Persona
from employees.utils import generar_matricula_seguro


class TestListarFuncionariosAPI(APITestCase):
    """GET /funcionarios/lista/ — accesible a cualquier usuario autenticado."""

    def setUp(self):
        self.user_rrhh, self.func_rrhh = hacer_usuario_y_funcionario(
            ci='10000001', nombre='Admin RRHH', roles=['RRHH']
        )
        self.user_normal, _ = hacer_usuario_y_funcionario(
            ci='10000002', nombre='Empleado Normal'
        )
        hacer_cargo(self.func_rrhh)
        self.url = reverse('funcionarios_lista')

    def test_requiere_autenticacion(self):
        # El middleware ControlAccesoRoles intercepta antes que DRF y redirige
        # al login (302) a cualquier usuario no autenticado, incluidas las APIs.
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, status.HTTP_302_FOUND)

    def test_cualquier_usuario_autenticado_puede_listar(self):
        # La vista no tiene restricción de rol; solo requiere login
        self.client.force_login(self.user_normal)
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, status.HTTP_200_OK)

    def test_con_rol_rrhh_devuelve_funcionarios(self):
        self.client.force_login(self.user_rrhh)
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        data = r.json()
        self.assertIn('funcionarios', data)
        self.assertIsInstance(data['funcionarios'], list)

    def test_resultado_incluye_campos_esperados(self):
        self.client.force_login(self.user_rrhh)
        r = self.client.get(self.url)
        funcs = r.json()['funcionarios']
        if funcs:
            f = funcs[0]
            for campo in ('cod', 'ci', 'nombre', 'estado', 'cargo'):
                self.assertIn(campo, f, f'Campo "{campo}" ausente en respuesta')


class TestNuevoFuncionarioAPI(APITestCase):
    """POST /funcionarios/nuevo/ — crea Persona + Funcionario (requiere rol RRHH)."""

    def setUp(self):
        self.user, _ = hacer_usuario_y_funcionario(ci='20000001', nombre='Usuario', roles=['RRHH'])
        self.client.force_login(self.user)
        self.unidad = hacer_unidad('Unidad Registro')
        self.url = reverse('funcionarios_nuevo')

    def _payload(self, ci='30000001'):
        return {
            'ci':              ci,
            'nombres':         'Nuevo',
            'ap_paterno':      'Funcionario',
            'ap_materno':      'Test',
            'fecha_nacimiento': '1990-05-20',
            'sexo':            'Masculino',
            'fecha_ingreso':   '2025-01-01',
            'tipo_funcionario': 'PERSONAL DE AREA',
            'unidad':          self.unidad.nombre,
            'cargo':           'Analista',
            'tipo_contrato':   'Fijo',
        }

    def test_crea_funcionario_exitosamente(self):
        r = self.client.post(self.url, self._payload(), format='json')
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertTrue(Persona.objects.filter(ci='30000001').exists())

    def test_ci_duplicado_devuelve_400(self):
        self.client.post(self.url, self._payload('40000001'), format='json')
        r2 = self.client.post(self.url, self._payload('40000001'), format='json')
        self.assertEqual(r2.status_code, status.HTTP_400_BAD_REQUEST)

    def test_campo_requerido_faltante_devuelve_400(self):
        payload = self._payload('50000001')
        del payload['nombres']
        r = self.client.post(self.url, payload, format='json')
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unidad_inexistente_devuelve_400(self):
        payload = self._payload('60000001')
        payload['unidad'] = 'Unidad Que No Existe'
        r = self.client.post(self.url, payload, format='json')
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_requiere_autenticacion(self):
        # El middleware ControlAccesoRoles intercepta antes que DRF y redirige
        # al login (302) a cualquier usuario no autenticado, incluidas las APIs.
        self.client.logout()
        r = self.client.post(self.url, self._payload('70000001'), format='json')
        self.assertEqual(r.status_code, status.HTTP_302_FOUND)


class TestToggleEstadoAPI(APITestCase):
    """POST /funcionarios/<cod>/estado/ — activa/desactiva funcionario (requiere rol RRHH)."""

    def setUp(self):
        self.user, _ = hacer_usuario_y_funcionario(ci='80000001', nombre='RRHH Toggle', roles=['RRHH'])
        _, self.objetivo = hacer_usuario_y_funcionario(ci='80000002', nombre='Objetivo')
        hacer_cargo(self.objetivo)
        self.client.force_login(self.user)
        self.url = reverse('funcionarios_estado', kwargs={'cod': self.objetivo.cod_funcionario})

    def test_desactiva_funcionario_activo(self):
        # Para desactivar se requieren fecha_baja y tipo_baja
        r = self.client.post(
            self.url,
            {'fecha_baja': '2025-06-01', 'tipo_baja': 'Renuncia'},
            format='json',
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.objetivo.refresh_from_db()
        self.assertEqual(self.objetivo.estado, 'INACTIVO')

    def test_desactivar_sin_fecha_baja_devuelve_400(self):
        r = self.client.post(self.url, {}, format='json')
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_activa_funcionario_inactivo(self):
        self.objetivo.estado = 'INACTIVO'
        self.objetivo.save(update_fields=['estado'])
        r = self.client.post(self.url, {}, format='json')
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.objetivo.refresh_from_db()
        self.assertEqual(self.objetivo.estado, 'ACTIVO')

    def test_funcionario_inexistente_devuelve_404(self):
        url = reverse('funcionarios_estado', kwargs={'cod': 'NOEXISTE'})
        r = self.client.post(url, {}, format='json')
        self.assertEqual(r.status_code, status.HTTP_404_NOT_FOUND)


class TestBuscarFuncionariosAPI(APITestCase):
    """GET /funcionarios/buscar/ — búsqueda por nombre, q mínimo 2 chars."""

    def setUp(self):
        self.user, _ = hacer_usuario_y_funcionario(ci='90000001', nombre='Buscador')
        self.client.force_login(self.user)
        self.url = reverse('funcionarios_buscar')

    def test_busqueda_devuelve_estructura_correcta(self):
        r = self.client.get(self.url, {'q': 'Buscado'})
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        data = r.json()
        self.assertIn('funcionarios', data)
        self.assertIsInstance(data['funcionarios'], list)

    def test_busqueda_corta_devuelve_lista_vacia(self):
        # q < 2 chars → vacío sin error
        r = self.client.get(self.url, {'q': 'X'})
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(r.json()['funcionarios'], [])

    def test_busqueda_sin_resultados_devuelve_lista_vacia(self):
        r = self.client.get(self.url, {'q': 'XZXZnoexiste'})
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(r.json()['funcionarios'], [])


class TestGenerarMatriculaSeguro(APITestCase):
    """employees.utils.generar_matricula_seguro — formato de 9 dígitos."""

    def _persona(self, **kw):
        base = dict(
            ci='77700001', nombre='Fedra', ap_paterno='Montero',
            ap_materno='Suarez', fecha_nacimiento=date(1990, 3, 7),
            sexo='Femenino',
        )
        base.update(kw)
        return Persona(**base)

    def test_varon_usa_el_mes_tal_cual(self):
        p = self._persona(nombre='Juan', ap_paterno='Perez', ap_materno='Lopez',
                          fecha_nacimiento=date(1986, 5, 5), sexo='Masculino')
        self.assertEqual(generar_matricula_seguro(p), '860505PLJ')

    def test_mujer_suma_50_al_mes(self):
        # marzo (3) + 50 = 53 → rango femenino 51-62
        p = self._persona()
        self.assertEqual(generar_matricula_seguro(p), '905307MSF')

    def test_mujer_enero_y_diciembre_en_los_bordes(self):
        enero = self._persona(fecha_nacimiento=date(1990, 1, 7))
        dic   = self._persona(fecha_nacimiento=date(1990, 12, 7))
        self.assertTrue(generar_matricula_seguro(enero).startswith('9051'))
        self.assertTrue(generar_matricula_seguro(dic).startswith('9062'))

    def test_un_solo_nombre_una_inicial_dos_nombres_dos_iniciales(self):
        uno = self._persona(nombre='Fedra')
        dos = self._persona(nombre='Fatima Carmela', ap_paterno='Vaca',
                            ap_materno='Hurtado', fecha_nacimiento=date(1980, 4, 20))
        self.assertEqual(generar_matricula_seguro(uno), '905307MSF')
        self.assertEqual(generar_matricula_seguro(dos), '805420VHFC')

    def test_acentos_y_dia_con_cero_a_la_izquierda(self):
        p = self._persona(nombre='Angela', ap_paterno='Nunez', ap_materno='Ibanez',
                          fecha_nacimiento=date(2001, 8, 3))
        self.assertEqual(generar_matricula_seguro(p), '015803NIA')
