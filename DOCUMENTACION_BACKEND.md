# Documentación Backend — CORE SSU v2

## Arquitectura general

CORE SSU v2 es un sistema Django de gestión de vacaciones para el Seguro Social Universitario, estructurado en seis apps de dominio (`accounts`, `core`, `dashboard`, `employees`, `reports`, `vacations`) más el paquete de configuración raíz `config/`. El patrón general es **Django server-rendered para las páginas HTML** (una vista por pantalla, que renderiza un template y pasa contexto mínimo) combinado con **Django REST Framework (DRF) para las APIs** que consume el JavaScript vanilla en `static/js/<app>/*.js` vía `fetch`/AJAX. No se usa ningún framework SPA (React/Vue/Angular): cada pantalla HTML tiene un archivo JS asociado del mismo nombre que hidrata la interfaz, hace las llamadas a los endpoints DRF y maneja el DOM directamente.

**Control de acceso por rol** es un sistema propio de doble capa:
- Para vistas HTML: el middleware `core/middleware.py` (`ControlAccesoRoles`, registrado en `MIDDLEWARE` después de `AuthenticationMiddleware`) intercepta cada request, resuelve el `url_name` de la ruta solicitada, obtiene los roles del usuario vía `core/roles.py` (`obtener_roles`, que consulta `Funcionario` y `FuncionarioRol` en la BD) y consulta la matriz centralizada `core/permissions.py` (`PERMISOS`, `URL_ABIERTAS`, función `puede_acceder`) para decidir si permite el acceso, redirige al login, fuerza el cambio de contraseña pendiente, o bloquea con una página 403. Los intentos denegados se registran tanto en el logger `ssu.acceso_denegado` como en el modelo `IntentosAcceso`.
- Para las APIs DRF: se usan clases de permiso reutilizables en `core/api_permissions.py` (`TieneRol` como base parametrizable vía `TieneRol.para({...})`, y subclases concretas `EsAdminOSistema`, `EsRRHH`, `EsAprobador`, `EsAuditoria`, `EsFuncionarioActivo`, más `NoCambioPendiente` que bloquea si el usuario tiene un cambio de contraseña forzado pendiente), configuradas por vista/endpoint según el rol requerido.

Los roles del sistema son: `Administrador`, `RRHH`, `Auditoria`, `Funcionario` (rol base que todo usuario autenticado activo posee), `Jefe de Area`, `Gerente Administrativo`, `Gerente de Salud` y `Gerente General` (estos últimos cuatro conforman la cadena de aprobación jerárquica de solicitudes de vacaciones).

**Patrón de datos notable:** la gran mayoría de los modelos usan `managed = False` en su `Meta`, es decir, apuntan a tablas ya existentes en una base de datos PostgreSQL preexistente/externa (`db_core_ssu`) que Django no gestiona con sus migraciones estándar. Las pocas migraciones reales del proyecto (una en `core`, tres en `employees`, una en `vacations`, ninguna en `accounts`/`dashboard`/`reports`) se usan solo para: (a) crear tablas nuevas de soporte que sí son gestionadas por Django (p. ej. `IntentosAcceso` para auditoría de accesos denegados), o (b) alterar el esquema de tablas externas mediante `migrations.RunSQL` (p. ej. agregar la columna `dias_perdidos` a `gestion_vacacion`, o agregar `fecha_baja`/`tipo_baja` a la tabla de funcionarios), evitando que Django intente recrear tablas que ya existen.

Otros patrones notables: `TEST_RUNNER` personalizado (`core.test_runner.ManagedTestRunner`) que habilita temporalmente los modelos `managed=False` y desactiva las migraciones locales durante la ejecución de tests, para poder crear/destruir la BD de test por introspección de modelos sin que los `RunSQL` fallen contra tablas inexistentes; manejador de excepciones DRF centralizado (`core.api_exceptions.manejar_excepcion`) configurado como `EXCEPTION_HANDLER` en `REST_FRAMEWORK`; context processors propios (`accounts.context_processors.foto_perfil`, `accounts.context_processors.permisos_usuario`) que inyectan datos de perfil y permisos a todos los templates; y un template tag custom (`core/templatetags/static_v.py`, `{% staticv %}`) que envuelve `{% static %}` para versionar/cachebustear los assets estáticos según su fecha de modificación en disco.

---

## App: accounts

### accounts/models.py
Define dos modelos `managed = False` (tablas preexistentes en la BD externa), complementarios al modelo `Funcionario` de `employees`:

- **`Roles`** (`db_table='roles'`): catálogo de roles del sistema. PK `id_roles`, `tipo_rol` (CharField único, 50 — los valores literales usados en toda la matriz de permisos: `Administrador`, `RRHH`, etc.), `descripcion` opcional.
- **`FuncionarioRol`** (`db_table='funcionario_rol'`): tabla puente que asigna roles a funcionarios, con historial. PK `id_func_rol`. `cod_funcionario` (FK a `employees.Funcionario`, `CASCADE`, related_name `roles_asignados`), `id_roles` (FK a `Roles`, `DO_NOTHING`), `fecha_asignacion` (auto_now_add), `fecha_revocacion` (opcional), `activo` (booleano — solo los `activo=True` cuentan para `obtener_roles`), `asignado_por` (FK a `Funcionario`, quién otorgó el rol, opcional). Es la tabla que consulta `core/roles.py` para construir el set de roles de cada usuario.

### accounts/views.py
Vistas HTML clásicas (460 líneas) que cubren autenticación, perfil de usuario, foto de perfil, cambio/recuperación de contraseña. Importa `Persona`, `Funcionario`, `HistorialCargo` de `employees` y `FuncionarioRol` de `accounts`.

Constantes: `_PATRON_CONTRASENA` (regex que exige minúscula, mayúscula, dígito, carácter especial de `@$!%*?&#` y mínimo 8 caracteres), `_LOGIN_MAX_INTENTOS=5`, `_LOGIN_BLOQUEO_SEGUNDOS=900` (15 min), `_FIRMAS_IMAGEN` (magic bytes de JPEG/PNG/GIF para validar imágenes subidas sin depender de la extensión del archivo).

- **`login_view(request)`** — `GET/POST`, sin decorador (pública, es `login_home`). En `POST`: usa `django.core.cache` para rate-limiting por usuario (`clave_intentos`/`clave_bloqueo`), bloquea 15 minutos tras 5 fallos. Autentica con `django.contrib.auth.authenticate`. Si el `Funcionario` asociado no está `ACTIVO`, rechaza el login aunque las credenciales sean correctas ("Su acceso ha sido deshabilitado"). Si `contrasena_hash == '1234567'` (contraseña inicial por defecto asignada por RRHH al crear el funcionario), fuerza `session['debe_cambiar_contrasena']=True` y redirige a `contrasena` — este flag es el que intercepta `core/middleware.py` para bloquear el resto de la navegación. En éxito redirige a `index`.
- **`perfil_view(request)`** — `GET`, `@login_required`. Arma el contexto completo de la pantalla de perfil: datos de `Persona`/`Funcionario`, historial de cargos formateado (con duración calculada vía `_calcular_duracion`), lista de roles con ícono asignado por `_icono_para_rol` (heurística por substring: "admin"→shield, "gerente"/"jefe"→manage_accounts, "recursos"/"rrhh"→groups, resto→badge), y flags `mostrar_expandir_historial`/`roles` (si hay más de 2 entradas, la UI colapsa). Corresponde a `url_name='perfil'` (URL_ABIERTAS, solo requiere login).
- **`foto_perfil(request)`** — `GET/POST`, `@login_required`. `GET`: sirve la foto binaria almacenada en `Persona.foto` detectando el `content_type` real por magic bytes (`_detectar_content_type`). `POST`: valida tamaño (&lt;5MB) y que sea una imagen válida por firma binaria (no confía en `Content-Type` del navegador) antes de guardar los bytes crudos en la BD.
- **`eliminar_foto_perfil(request)`** — `POST` (`@require_POST`), `@login_required`. Limpia `Persona.foto`.
- **`_verificar_contrasena(ingresada, almacenada)`**: helper que intenta primero verificar contra un hash Django (`check_password`) y si falla compara texto plano — soporta la transición de contraseñas iniciales en texto plano (`'1234567'`) hacia hashes reales.
- **`cambiar_contrasena_view(request)`** — `GET/POST`, `@login_required`. `GET` renderiza el form indicando si el cambio es `forzado` (por el flag de sesión). `POST` (body JSON): valida campos, coincidencia, complejidad regex, verifica la contraseña actual contra `funcionario.contrasena_hash`, y si todo es válido actualiza **tanto** `Funcionario.contrasena_hash` (con `make_password`, hash real) **como** `User.set_password` de Django, manteniendo sincronizados el sistema legado y `auth.User`; usa `update_session_auth_hash` para no cerrar la sesión tras cambiar el password; limpia el flag `debe_cambiar_contrasena`.
- **`recuperar_contrasena_view(request)`** — `GET`, pública, solo renderiza el template (la lógica vive en `recuperar_verificar`/`recuperar_nueva_contrasena`).
- **`_incrementar_intentos_rec(ci)`**: rate-limiting análogo al de login pero para el flujo de recuperación (bloqueo tras 3 intentos, 15 min).
- **`recuperar_verificar(request)`** — `POST` (`@require_POST`), pública. Verifica identidad sin contraseña: exige que `ci` + `fecha_nacimiento` + `matricula_seguro` coincidan exactamente con los registros de `Persona`/`Funcionario` (`estado='ACTIVO'`). Si coincide, guarda `session['recuperacion_ci']` con expiración de 10 minutos como token temporal de sesión de recuperación.
- **`recuperar_nueva_contrasena(request)`** — `POST`, pública pero exige `session['recuperacion_ci']` presente (403 si no). Aplica las mismas validaciones de complejidad/coincidencia y actualiza `Funcionario.contrasena_hash` + `User.password`.
- **`mi_perfil_api(request)`** — `GET`, `@login_required`. Vista HTML "legacy" duplicada funcionalmente de `api_views.MiPerfilView` (DRF): retorna `JsonResponse` con nombre completo, nombre abreviado (`"Nombre I."`), CI y lista de roles activos (siempre con `'Funcionario'` incluido, ordenado con `'Funcionario'` primero). Es consumida por `static/js/shared/profile-switcher.js`. `url_name='mi_perfil_api'`, en `URL_ABIERTAS`.

Nota: hay una duplicación deliberada entre esta vista basada en función y `api_views.MiPerfilView`, ambas con lógica casi idéntica — probablemente una es remanente de una migración incremental hacia DRF.

### accounts/api_views.py
Módulo DRF (182 líneas) que expone en formato API algunas de las mismas operaciones de `views.py`, usando `core.api_permissions`.

- **`EliminarFotoView`** — `POST /perfil/foto/eliminar/` (`perfil_foto_eliminar`). Permisos `[NoCambioPendiente, EsFuncionarioActivo]`. Limpia `Persona.foto`. (En `URL_ABIERTAS`.)
- **`MiPerfilView`** — `GET /api/usuario/mi-perfil/` (`mi_perfil_api`). Permisos `[NoCambioPendiente, EsFuncionarioActivo]`. Misma lógica que `views.mi_perfil_api` (duplicado en versión DRF) — retorna código, nombre completo/abreviado, roles, CI. Es el endpoint realmente enrutado en `accounts/urls.py` bajo ese `name` (la versión de `views.py` con el mismo nombre de función no está enrutada, solo definida).
- **`RecuperarVerificarView`** — `POST /recuperar/verificar/` (`recuperar_verificar`). Permisos `[AllowAny]` (pública, sin sesión). Misma lógica de verificación por CI+fecha nacimiento+matrícula que `views.recuperar_verificar`, con rate-limiting compartido (`_incrementar_intentos_rec`, mismas claves de cache). Responde `429 Too Many Requests` si está bloqueado (a diferencia de la versión HTML que usaba mensajes flash).
- **`RecuperarNuevaView`** — `POST /recuperar/nueva/` (`recuperar_nueva`). Permisos `[AllowAny]`. Exige `session['recuperacion_ci']`; valida y actualiza contraseña igual que la versión HTML.

Al igual que en `views.py`, hay duplicación funcional casi total entre la versión de función (`views.py`) y la versión DRF (`api_views.py`) de recuperación de contraseña y perfil — el enrutamiento real (`accounts/urls.py`) usa las clases DRF de `api_views.py` para `mi_perfil_api`, `recuperar_verificar` y `recuperar_nueva`, y las funciones de `views.py` para `foto_perfil` y `login_home` (mezcla de ambos estilos convivientes en la misma app).

### accounts/urls.py
Rutas registradas en esta app: `''` → `views.login_view` (`login_home`, vista pública de login); `perfil/foto/` → `views.foto_perfil` (`perfil_foto`); `perfil/foto/eliminar/` → `api_views.EliminarFotoView` (`perfil_foto_eliminar`); `api/usuario/mi-perfil/` → `api_views.MiPerfilView` (`mi_perfil_api`); `recuperar/verificar/` → `api_views.RecuperarVerificarView` (`recuperar_verificar`); `recuperar/nueva/` → `api_views.RecuperarNuevaView` (`recuperar_nueva`). Las vistas `perfil_view`, `cambiar_contrasena_view` y `recuperar_contrasena_view` se enrutan desde `config/urls.py` (nivel raíz), no aquí.

### accounts/apps.py
Configuración estándar: `AccountsConfig(AppConfig)` con `name='accounts'`, sin lógica adicional.

### accounts/admin.py
Vacío (boilerplate estándar). Ningún modelo de `accounts` registrado en el admin de Django.

### accounts/context_processors.py
Dos context processors registrados globalmente en `TEMPLATES.OPTIONS.context_processors` de `config/settings.py`, disponibles en **todos** los templates del proyecto:

- **`foto_perfil(request)`**: inyecta `tiene_foto_perfil` (booleano) consultando solo el campo `foto` de `Persona` (`.only('foto')`). Usado para decidir si mostrar la miniatura de foto o un placeholder en el header.
- **`permisos_usuario(request)`**: el más importante — inyecta `modulos_permitidos` (unión de `URL_ABIERTAS` y todos los `url_name` de `PERMISOS` a los que el usuario tiene acceso según sus roles, usado para pintar/ocultar ítems del menú lateral sin duplicar la matriz en cada template), `roles_activos` (lista para mostrar en UI, sin `'Funcionario'` si tiene otros roles), `rol_principal` (primer rol de `PRIORIDAD_ROL` presente en el set del usuario), `nombre_completo_usuario`, `cargo_actual_usuario` (desde `HistorialCargo` con `es_actual=True`) y `descripcion_rol_principal` (desde `Roles.descripcion`). Reutiliza `core.middleware._obtener_roles(request)` (la misma función cacheada en `request._ssu_roles` que usa el middleware, evitando repetir la consulta de roles dos veces por request) y las constantes de `core.permissions`.

### accounts/tests.py
Suite de tests (169 líneas) organizada en 3 clases:

- **`TestCambiarContrasenaView`** (`TestCase`, contra `views.cambiar_contrasena_view`): GET devuelve 200; cambio exitoso responde `{'ok': True}`; contraseña actual incorrecta → 400; confirmación no coincide → 400; contraseña débil (sin símbolo especial) → 400; sin autenticación → redirige 302.
- **`TestForzarCambioContrasena`**: prueba el comportamiento del middleware `ControlAccesoRoles` respecto al flag `debe_cambiar_contrasena` en sesión — sin flag accede normalmente; con flag, cualquier URL redirige a `contrasena` (excepto `contrasena` y `login_home` que siguen accesibles); tras un cambio exitoso el flag se limpia de la sesión.
- **`TestRecuperarContrasenaView`** (`APITestCase`, contra el endpoint DRF `/recuperar/verificar/`): accesible sin autenticación (no 401/403 por auth, aunque puede devolver 400 por datos), CI inexistente devuelve 400.

### accounts/migrations/
No existen migraciones (`accounts` no tiene ni siquiera un `migrations/0001_...py`, coherente con que sus dos modelos son `managed=False` sobre tablas que ya existían antes de que el proyecto Django gestionara esta app).

---

## App: core

### core/models.py
Define tres modelos:

- **`IntentosAcceso`** (`db_table='intentos_acceso'`, único modelo **managed** de toda la app `core` — es una tabla nueva creada por la migración `0001_intentos_acceso.py`, no una tabla legada): auditoría de accesos denegados por rol. Campos: `username`, `path`, `url_name` (opcional), `roles` (string separado por comas), `ip` (`GenericIPAddressField`, opcional), `timestamp` (`auto_now_add`). `Meta.ordering=['-timestamp']`. Poblada por `core/middleware.py` cada vez que `ControlAccesoRoles` bloquea un acceso.
- **`UnidadOrganizacional`** (`db_table='unidad_organizacional'`, `managed=False`): catálogo de unidades/departamentos de la institución. PK `id_unidad`, `nombre` (único), `descripcion` opcional, `activo` (booleano). Referenciada por `employees.Funcionario.id_unidad`.
- **`Feriado`** (`db_table='feriado'`, `managed=False`): catálogo de feriados usados en el cálculo de días hábiles de vacaciones. PK `id_feriado`, `fecha` (única), `descripcion`, `tipo` (choices: Internacional, Nacional, Departamental, Municipal, Institucional).

### core/views.py
Archivo mínimo (13 líneas): una sola vista, **`feriados_view(request)`** — `GET`, `@login_required`. Renderiza `core/Feriados.html` pasando `anio_actual` (año actual) y `tipos` (la lista fija `TIPOS_FERIADO`) como contexto inicial para poblar selects del formulario/filtro en el cliente. Corresponde a `url_name='feriados'` (roles RRHH, Administrador según la matriz de `core/permissions.py`). Toda la carga/CRUD real de feriados ocurre vía las APIs DRF de `core/api_views.py`.

### core/api_views.py
CRUD DRF completo de feriados (128 líneas), consumido por `static/js/core/Feriados.js`.

- **`FeriadosListView`** — `GET /feriados/lista/` (`feriados_lista`, en `URL_ABIERTAS`). Permisos `[NoCambioPendiente, EsFuncionarioActivo]` (lectura abierta a cualquier funcionario activo, no solo RRHH — coherente con que el cálculo de vacaciones necesita esta lista para cualquier usuario). Filtros opcionales por query params `anio` (parseado a int con manejo de excepción silenciosa si no es numérico) y `tipo` (si no es `'Todos'`). Ordena por `fecha`.
- **`FeriadosCreateView`** — `POST /feriados/agregar/` (`feriados_agregar`). Permisos `[NoCambioPendiente, EsRRHH]`. Valida con `FeriadoSerializer` (DRF `Serializer`, no `ModelSerializer`). Verifica unicidad de fecha antes de crear (más un catch de `IntegrityError` como defensa adicional ante condiciones de carrera). Responde 201.
- **`FeriadoEditView`** — `POST /feriados/&lt;id_feriado&gt;/editar/` (`feriados_editar`). Permisos `[NoCambioPendiente, EsRRHH]`. 404 si no existe el feriado; valida unicidad de fecha excluyendo el propio registro; usa `save(update_fields=[...])`.
- **`FeriadoDeleteView`** — `POST /feriados/&lt;id_feriado&gt;/eliminar/` (`feriados_eliminar`). Permisos `[NoCambioPendiente, EsRRHH]`. 404 si no existe; elimina físicamente el registro.

Todas las mutaciones usan `POST` (no PUT/PATCH/DELETE HTTP semánticos), patrón consistente en todo el proyecto.

### core/api_exceptions.py
**`manejar_excepcion(exc, context)`**: handler configurado globalmente como `REST_FRAMEWORK.EXCEPTION_HANDLER` en `settings.py`. Primero delega al `exception_handler` estándar de DRF; si DRF ya sabe manejar la excepción (ej. `ValidationError`, `NotAuthenticated`, `PermissionDenied`), retorna esa respuesta tal cual. Si DRF devuelve `None` (excepción no reconocida, ej. un error de programación/BD no capturado), registra el traceback completo en el logger `ssu.acceso_denegado` con `exc_info=exc` y devuelve una respuesta genérica `500` con mensaje `'Error interno del servidor...'` sin exponer detalles internos al cliente.

### core/api_permissions.py
Define permisos DRF reutilizables: **`NoCambioPendiente`** (bloquea si `session['debe_cambiar_contrasena']` es true), **`TieneRol`** (clase base parametrizable con `roles_requeridos` y el método de clase `TieneRol.para({...})` para generar permisos ad-hoc sin declarar una subclase), y las subclases concretas **`EsAdminOSistema`** (`{Administrador}`), **`EsRRHH`** (`{RRHH, Administrador}`), **`EsAprobador`** (`{Administrador, Jefe de Area, Gerente Administrativo, Gerente de Salud, Gerente General}`), **`EsAuditoria`** (`{Auditoria, RRHH, Administrador}`), y **`EsFuncionarioActivo`** (permite a cualquier usuario autenticado cuyo set de roles contenga `'Funcionario'`, que es el rol base que `obtener_roles` siempre añade). Todas obtienen los roles vía `core.roles.obtener_roles(request.user.username)`.

### core/permissions.py
Contiene la matriz `PERMISOS: dict[str, frozenset]` que mapea 12 `url_name` a los roles autorizados (`funcionarios`, `historial_cargos`, `feriados`, `vacaciones`, `solicitudes`, `aprobacion`, `formulario_vac`, `historial_rrhh`, `anulacion`, `reporte_p`, `reporte_g`), el set `URL_ABIERTAS` (URLs que solo requieren login, sin restricción de rol — incluye login/perfil/contraseña, foto de perfil, y una veintena de endpoints de API compartidos como `vac_datos`, `funcionarios_lista`, `feriados_lista`), la lista `PRIORIDAD_ROL` (orden para elegir el "rol principal" a mostrar en la UI cuando el usuario tiene varios) y la función `puede_acceder(roles_usuario, url_name) -> bool` (True si la URL está abierta, o si no está registrada en `PERMISOS` en absoluto —fail-open para URLs no contempladas—, o si hay intersección entre los roles del usuario y los permitidos).

### core/middleware.py
Define `_URLS_PUBLICAS` (login, login_home, recuperar y sus dos pasos), `_obtener_roles(request)` (wrapper que cachea el resultado de `core.roles.obtener_roles` en `request._ssu_roles` para no repetir la consulta a BD si se llama varias veces en el mismo request — usado también por `accounts.context_processors.permisos_usuario`), y la clase `ControlAccesoRoles` cuyo método `_verificar` implementa, en orden: (1) resolver `url_name` (deja pasar si no matchea ninguna URL registrada), (2) si no autenticado, dejar pasar URLs públicas/admin/static/media, si no redirigir a `login_home`, (3) si hay flag `debe_cambiar_contrasena` en sesión, forzar redirección a `contrasena` salvo en `contrasena`/`login_home`/`login`, (4) consultar `puede_acceder`, y si falla, registrar el intento (`_registrar`: logger + `IntentosAcceso.objects.create`, con `try/except` silencioso para que un fallo de BD no rompa el flujo) y devolver `shared/sin_acceso.html` con status 403.

### core/roles.py
Única función **`obtener_roles(username)`**: busca `Funcionario.objects.get(ci__ci=username, estado='ACTIVO')`, si existe recolecta los `tipo_rol` de sus `FuncionarioRol` activos; captura `Funcionario.DoesNotExist` (usuario sin registro de funcionario → set vacío) y cualquier otra excepción (loggeada como error, también set vacío, evitando que un fallo de BD tumbe el middleware). Siempre añade `'Funcionario'` al resultado final antes de retornar — es el "piso" de rol que todo usuario autenticado con funcionario activo posee.

### core/serializers.py
Un único serializer: **`FeriadoSerializer`** (`serializers.Serializer`, no `ModelSerializer` — validación desacoplada del modelo). Campos: `fecha` (`DateField`), `descripcion` (`CharField`, max 200), `tipo` (`ChoiceField` sobre la lista `TIPOS_FERIADO` — duplicada aquí y en `core/views.py`/`core/models.py.Feriado.TIPO_CHOICES`, tres fuentes de verdad para el mismo catálogo de tipos).

### core/urls.py
Cuatro rutas, todas del CRUD de feriados: `feriados/lista/` (`feriados_lista`), `feriados/agregar/` (`feriados_agregar`), `feriados/&lt;int:id_feriado&gt;/editar/` (`feriados_editar`), `feriados/&lt;int:id_feriado&gt;/eliminar/` (`feriados_eliminar`). La vista HTML `feriados_view` se enruta desde `config/urls.py` raíz.

### core/apps.py
Configuración estándar: `CoreConfig(AppConfig)` con `name='core'`, sin lógica en `ready()` (a diferencia de `vacations/apps.py`).

### core/admin.py
Vacío (boilerplate). Ningún modelo de `core` registrado en el admin (ni siquiera `IntentosAcceso`, que sí es `managed=True`).

### core/templatetags/static_v.py
Define el template tag custom `{% staticv %}` (`@register.simple_tag`), usado en templates en vez de `{% static %}` estándar. **`staticv(path)`**: resuelve la URL estática normal con `django.templatetags.static.static`, y si el archivo existe físicamente (`django.contrib.staticfiles.finders.find`), le agrega un query string `?v={timestamp}` basado en `os.path.getmtime` del archivo — cache-busting automático basado en la fecha de modificación del archivo, sin pipeline de hashing de assets. Si el archivo no se encuentra, retorna la URL sin versionar.

### core/test_runner.py
**`ManagedTestRunner(DiscoverRunner)`**: runner de tests custom configurado en `settings.TEST_RUNNER`, diseñado para el patrón `managed=False` + migraciones `RunSQL` del proyecto. Problema que resuelve: en una BD de test vacía las tablas legadas no existen y los `RunSQL` (`ALTER TABLE ...`) fallarían. Solución: en `setup_databases`/`teardown_databases`, temporalmente (a) marca **todos** los modelos como `managed=True` (`_set_managed`) para que Django los cree vía syncdb normal, y (b) desactiva `MIGRATION_MODULES` para las 6 apps locales (`_disable_migrations`, forzando a Django a crear el esquema completo por introspección de modelos en vez de aplicar migraciones) — evitando que se ejecute el `RunSQL` sobre tablas inexistentes. Restaura ambos estados en el `finally`.

### core/test_utils.py
Módulo de **factories compartidas** para tests de integración de todo el proyecto, reutilizado por `accounts/tests.py`, `employees/tests.py`, `core/tests.py` y `vacations/tests.py`.

- **`hacer_unidad(nombre='Unidad Test')`**: `get_or_create` de `UnidadOrganizacional`.
- **`hacer_funcionario(ci, nombre, ap_paterno, fecha_nacimiento, fecha_ingreso, tipo, unidad)`**: crea el grafo `Persona` → `Funcionario` con valores por defecto razonables.
- **`hacer_usuario_y_funcionario(ci, nombre, fecha_ingreso, tipo, roles)`**: además crea el `User` de Django (`create_user`) y opcionalmente asigna una lista de `Roles`/`FuncionarioRol` activos. Es el factory más usado en tests de vistas/API que requieren `force_login`.
- **`hacer_gestion(funcionario, anio1, dias1=15)`**: crea un `GestionVacacion` con la primera gestión poblada (`refresh_from_db()` para traer el `GeneratedField dias_adeudados`).
- **`hacer_cargo(funcionario, cargo='Analista', tipo_contrato='Fijo')`**: crea un `HistorialCargo` marcado `es_actual=True`.

### core/tests.py
Suite de tests (173 líneas) del CRUD de feriados, en 4 clases `APITestCase`: **`TestFeriadosListAPI`** (requiere autenticación → 403 si no, lista completa, filtro por año, filtro por tipo, filtro combinado, estructura de respuesta); **`TestFeriadosCreateAPI`** (creación exitosa 201, fecha duplicada → 400, fecha inválida → 400, tipo inválido → 400, descripción vacía → 400, los 5 tipos válidos son aceptados); **`TestFeriadoEditAPI`** (edición exitosa, fecha ya usada por otro feriado → 400, feriado inexistente → 404); **`TestFeriadoDeleteAPI`** (eliminación exitosa, inexistente → 404).

### core/migrations/
Un único archivo, **`0001_intentos_acceso.py`**: crea la tabla `intentos_acceso` (managed) para el log de auditoría de accesos denegados, y referencia (sin gestionarlas realmente, `managed: False` en sus `options`) las tablas legadas `feriado` y `unidad_organizacional`.

---

## App: dashboard

### dashboard/models.py
Archivo vacío (solo el boilerplate estándar `from django.db import models` y el comentario `# Create your models here.`). La app `dashboard` no define ningún modelo propio; no persiste datos propios en la base. Su función es puramente de presentación (pantalla de inicio/índice del sistema), delegando cualquier dato mostrado a modelos de otras apps (`core`, `employees`, `vacations`, etc.) consultados desde otras vistas o vía templates que incluyen fragmentos de otras apps.

### dashboard/views.py
Archivo vacío salvo el import boilerplate `from django.shortcuts import render` y el comentario `# Create your views here.`. No hay ninguna vista implementada en este archivo. La pantalla de dashboard/inicio se sirve directamente desde `config/urls.py` (`Index_Principal.html` enrutada con `TemplateView` genérico + `login_required`), no desde esta app.

### dashboard/apps.py
Configuración estándar de la app Django: define `DashboardConfig(AppConfig)` con `name = 'dashboard'`. No sobreescribe `ready()` ni registra señales; es el boilerplate mínimo generado por `startapp`.

### dashboard/admin.py
Vacío (solo `from django.contrib import admin` y comentario). No se registra ningún modelo en el admin de Django para esta app.

### dashboard/tests.py
Vacío (solo `from django.test import TestCase` y comentario). No existe cobertura de tests para esta app.

### dashboard/migrations/
Solo contiene `__init__.py` (paquete Python vacío). No hay migraciones de esquema definidas, coherente con la ausencia total de modelos en `dashboard/models.py`.

**Conclusión sobre `dashboard`**: es una app Django completamente esqueleto/placeholder en su estado actual — sin modelos, sin vistas, sin admin, sin tests, sin migraciones reales. No aporta funcionalidad activa al sistema; el enrutamiento de la pantalla `Index_Principal.html` (dashboard real) se resuelve directamente en `config/urls.py` con un `TemplateView` genérico, no desde esta app.

---

## App: employees

### employees/models.py
Define tres modelos, todos `managed = False` (apuntan a tablas ya existentes en la BD PostgreSQL externa), sin `Meta.ordering` explícito:

- **`Persona`** (`db_table = 'persona'`): entidad que representa a la persona física, independiente de su rol laboral. Clave primaria es `ci` (`CharField`, max 20, es el carnet de identidad, no un id autoincremental). Campos: `nombre` (50), `ap_paterno` (50), `ap_materno` (50, opcional), `fecha_nacimiento` (`DateField`, obligatorio), `sexo` (`CharField` con choices `Masculino`/`Femenino`), `foto` (`BinaryField`, opcional — foto de perfil almacenada como bytes en la BD).

- **`Funcionario`** (`db_table = 'funcionario'`): representa al empleado/funcionario de la institución, en relación **uno-a-uno** con `Persona` vía `ci` (`OneToOneField` a `Persona`, `on_delete=CASCADE`, `db_column='ci'`). Clave primaria propia `cod_funcionario` (`CharField`, max 20 — código de funcionario, no autogenerado por Django sino calculado manualmente, ver `_siguiente_cod_funcionario` en `api_views.py`). Campos relevantes:
  - `matricula_seguro`: `CharField` único (20 chars), opcional — matrícula del seguro social generada por `employees/utils.py`.
  - `id_unidad`: `ForeignKey` a `core.UnidadOrganizacional` (`on_delete=DO_NOTHING`, `db_column='id_unidad'`) — la unidad organizacional a la que pertenece.
  - `fecha_ingreso`: `DateField` obligatorio.
  - `tipo_funcionario`: `CharField` (25) con choices cerradas: `PERSONAL DE AREA`, `JEFE AREA`, `DEPENDENCIA DIRECTA`, `GERENTE ADMINISTRATIVO`, `GERENTE SALUD`, `GERENTE GENERAL`. Este campo determina el nivel jerárquico del funcionario dentro del flujo de aprobación de vacaciones.
  - `estado`: `CharField` (10), default `'ACTIVO'` — estado laboral (`ACTIVO`/`INACTIVO`).
  - `fecha_baja`: `DateField` opcional — fecha de cese laboral.
  - `tipo_baja`: `CharField` (10) opcional, choices: `Despido`, `Renuncia`, `Muerte`.
  - `contrasena_hash`: `CharField` (255) — hash de contraseña (vestigio de un sistema de autenticación propio anterior/paralelo a Django `auth.User`, dado que en `api_views.py` también se crea un `User` de Django).
  - `fecha_registro`: `DateTimeField(auto_now_add=True)` — timestamp de creación del registro.

- **`HistorialCargo`** (`db_table = 'historial_cargo'`): registra el historial de cargos ocupados por un funcionario a lo largo del tiempo. PK `id_historial` (`AutoField`). `cod_funcionario`: `ForeignKey` a `Funcionario` (`CASCADE`). Campos: `cargo` (100), `tipo_contrato` (30), `fecha_inicio`/`fecha_fin` (`DateField`, `fecha_fin` opcional), `es_actual` (`BooleanField`, default `True` — marca cuál es el cargo vigente). Además guarda un **snapshot congelado del saldo de vacaciones al momento de dejar ese cargo**: cuatro pares de campos `saldo_gestionN_al_salir` (`DecimalField`, 4 dígitos, 1 decimal) y `anio_gestionN_al_salir` (`IntegerField`) para N=1..4, que preservan el saldo de hasta 4 gestiones/años de vacaciones pendientes en el momento del cambio de cargo o baja.

### employees/views.py (65 líneas)
Vistas HTML clásicas (no DRF) que renderizan templates y aplican control de acceso manual basado en roles (redundante/complementario al middleware `ControlAccesoRoles`). Define dos conjuntos de roles a nivel de módulo: `_ROLES_EMPLOYEES = {'RRHH', 'Administrador'}` y `_ROLES_HISTORIAL = {'Administrador', 'Auditoria'}`.

- **`funcionarios_view(request)`** — `GET`, protegida con `@login_required(login_url='login_home')`. Obtiene los roles del usuario vía `core.roles.obtener_roles`; si no intersecta con `_ROLES_EMPLOYEES` devuelve `shared/sin_acceso.html` con status 403. Si tiene acceso, renderiza `employees/Funcionarios.html` (la pantalla índice de gestión de funcionarios, que luego consume las APIs de `api_views.py` vía JS).

- **`historial_cargos_view(request)`** — `GET`, protegida igual con `login_required`. Verifica `_ROLES_HISTORIAL` (Administrador, Auditoria). Renderiza `employees/HistorialCargos.html`.

- **`exportar_funcionarios(request)`** — `GET`, protegida con `_ROLES_EMPLOYEES` (403 vía `JsonResponse` si no intersecta). Devuelve un `JsonResponse` con los funcionarios filtrados por query params: `unidad` (nombre exacto de unidad organizacional), `cargo` (substring, case-insensitive, filtrado en Python después de serializar), `estado` (`ACTIVO`/`INACTIVO`, si no es uno de esos dos se ignora el filtro). Construye el queryset con `Funcionario.objects.select_related('ci', 'id_unidad').order_by('estado', 'ci__ap_paterno')`, filtra por `id_unidad__nombre` y `estado` a nivel BD, y reutiliza `_serializar_funcionario` (importada desde `employees.api_views`) para transformar cada `Funcionario` en un diccionario, aplicando el filtro de `cargo` en memoria tras la serialización. Construye una lista `filtros` en texto legible. La respuesta incluye `funcionarios` (lista de dicts), `fecha` (hoy, `dd/mm/YYYY`), `filtros` y `area_label` (vía `_area_label_usuario`, importada desde `reports.api_views`, según el rol del usuario). El JS de `Funcionarios.js` (`generarFuncionariosPDF`) consume este JSON y genera el PDF en el cliente con `jsPDF`, usando la misma paleta y encabezado institucional (`PDF_THEME`) que Reporte Personal/General, y lo descarga directamente sin abrir pestaña ni vista previa de impresión.

Nota de acoplamiento: `views.py` importa `_serializar_funcionario` (función "privada" por convención de guion bajo) directamente desde `api_views.py`, mostrando reutilización de lógica de serialización entre la vista HTML de exportación y las APIs DRF.

### employees/api_views.py (899 líneas — módulo central de la app)
Módulo DRF con toda la lógica de negocio de gestión de funcionarios: CRUD, búsqueda, aprobadores, historial de cargos y generación de PDF de cierre de vacaciones al dar de baja. Importa modelos de varias apps: `core.models.UnidadOrganizacional`, `employees.models.{Persona, Funcionario, HistorialCargo}`, `accounts.models.{Roles, FuncionarioRol}`, `vacations.models.{GestionVacacion, JerarquiaAprobacion}`, y las clases de permisos de `core.api_permissions`: `NoCambioPendiente`, `EsRRHH`, `EsFuncionarioActivo`, `EsAuditoria`.

**Constantes de módulo:**
- `_NIVELES`: mapea `tipo_funcionario` → nivel numérico de aprobación (`PERSONAL DE AREA`: 3, `JEFE AREA`: 2, `DEPENDENCIA DIRECTA`/`GERENTE ADMINISTRATIVO`/`GERENTE SALUD`: 1, `GERENTE GENERAL`: 0). Se usa para determinar cuántos niveles de jerarquía de aprobación le corresponden a un funcionario y para "podar" niveles de `JerarquiaAprobacion` que ya no aplican tras un cambio de tipo.
- `_ROLES_EMPLOYEES`, `_ROLES_HISTORIAL`: igual que en `views.py`.
- `_SEXOS_VALIDOS`, `_TIPOS_FUNCIONARIO_VALIDOS` (derivado de las claves de `_NIVELES`), `_TIPOS_GERENTE` (`GERENTE ADMINISTRATIVO`, `GERENTE SALUD`, `GERENTE GENERAL`) — usados para validación de entrada.
- `_ROL_LABEL` / `_ROL_PRIORIDAD`: usados en `HistorialCargosView` para etiquetar quién consulta el historial (Administración vs Auditoría).

**Funciones helper de módulo:**

- **`_siguiente_cod_funcionario()`**: ejecuta SQL crudo (`connection.cursor()`) sobre la tabla `funcionario` para calcular `MAX(CAST(cod_funcionario AS INTEGER)) + 1`, filtrando con una expresión regular (`cod_funcionario ~ '^[0-9]+$'`) para ignorar códigos no puramente numéricos. Devuelve el siguiente código como string. Es la estrategia de generación de PK secuencial dado que `cod_funcionario` es un `CharField`, no un autoincremental de Django.

- **`_calcular_antiguedad(fecha_ingreso)`**: calcula la antigüedad laboral en años y meses respecto a `date.today()`, ajustando si el mes actual es menor al mes de ingreso. Devuelve string formateado `"{años}a {meses}m"` (ej. `"5a 3m"`), o `'-'` si no hay fecha.

- **`_serializar_funcionario(f, datos_sensibles=False)`**: función central de serialización, reutilizada por múltiples endpoints y por `views.exportar_funcionarios`. Dado un objeto `Funcionario`, construye un diccionario con: código, CI, nombre completo desagregado, sexo, cargo actual (busca `HistorialCargo` con `es_actual=True`; si no encuentra ninguno marcado como actual, hace fallback al de `fecha_inicio` más reciente), tipo de contrato del cargo actual, nombre de unidad, fecha de ingreso, tipo de funcionario, estado, antigüedad calculada, fecha y tipo de baja, lista de `roles` (nombres `tipo_rol` desde `FuncionarioRol` activos), lista `jerarquia` (nivel + código + nombre del aprobador, desde `JerarquiaAprobacion` activa, ordenada por nivel), y un flag booleano `sin_jefe_area` que detecta si un funcionario de tipo `PERSONAL DE AREA` **no tiene** ningún aprobador activo de tipo `JEFE AREA` en su cadena de jerarquía. Si `datos_sensibles=True` (reservado a RRHH), añade también `fecha_nacimiento` y `matricula_seguro`.

**Endpoints/Vistas (todas `APIView` de DRF):**

1. **`ListarFuncionariosView`** — `GET /funcionarios/lista/` (name `funcionarios_lista`). Permisos: `[NoCambioPendiente, EsFuncionarioActivo]` (cualquier funcionario activo autenticado, sin restricción de rol específico). Query params: `estado` (default `ACTIVO`), `q` (texto libre de búsqueda). Construye queryset `Funcionario.objects.select_related('ci', 'id_unidad').filter(estado=estado)`, evalúa `EsRRHH().has_permission(request, self)` manualmente para decidir si exponer `datos_sensibles=True` en la serialización. Filtra en memoria por `q` contra una cadena concatenada de ci/nombre/apellidos/cargo. Responde `{'funcionarios': [...]}` sin paginación DRF estándar.

2. **`AprobadoresView`** — `GET /funcionarios/aprobadores/` (name `funcionarios_aprobadores`). Permisos: `[NoCambioPendiente, EsRRHH]`. Query param opcional `excluir` (código de funcionario a excluir, típicamente el propio funcionario que se está editando). Devuelve `jefes_area`, `gerentes` (unión de Gerente Administrativo + Gerente de Salud), `gerente_general`, y `descripciones`. Alimenta el selector de aprobadores al crear/editar un funcionario.

3. **`NuevoFuncionarioView`** — `POST /funcionarios/nuevo/` (name `funcionarios_nuevo`). Permisos: `[NoCambioPendiente, EsRRHH]`. Body JSON: `ci, nombres, ap_paterno, ap_materno, fecha_nacimiento, sexo, matricula_seguro (opcional), cargo, tipo_contrato, unidad, fecha_ingreso, tipo_funcionario, roles (lista, default ['Funcionario']), jerarquia (lista de {aprobador_cod, nivel})`. Validaciones exhaustivas: campos obligatorios, `sexo`/`tipo_funcionario` válidos, longitudes máximas, unicidad de `ci`, parseo de fechas ISO, existencia de la `UnidadOrganizacional`. Dentro de `transaction.atomic()`: crea `Persona`, genera `cod_funcionario` y `matricula_seguro`, crea `Funcionario` (`contrasena_hash='1234567'` por defecto), crea el primer `HistorialCargo` (`es_actual=True`), crea `FuncionarioRol` por cada rol, crea `JerarquiaAprobacion` por cada entrada de jerarquía, crea un `User` de Django vinculado, llama a `vacations.utils.poblar_gestion_vacacion(funcionario)`, y si es tipo gerente, reasigna jerarquías previas apuntadas al gerente anterior del mismo tipo hacia el nuevo. Responde `201` con `{'ok': True, 'cod': cod, 'matricula_seguro': matricula}`.

4. **`EditarFuncionarioView`** — `POST /funcionarios/<cod>/editar/` (name `funcionarios_editar`). Permisos: `[NoCambioPendiente, EsRRHH]`. Actualiza `Persona` y `Funcionario`. Si el cargo actual cambió, congela el saldo de vacaciones vigente en el `HistorialCargo` saliente (`*_al_salir`), lo marca `es_actual=False`, y crea uno nuevo `es_actual=True`. Sincroniza roles (crea/desactiva `FuncionarioRol`, nunca desactiva `'Funcionario'`). Sincroniza jerarquía nivel por nivel (crea, reemplaza o mantiene según corresponda). Poda jerarquías con nivel mayor al permitido por el nuevo tipo. Si cambió a tipo gerente, reasigna jerarquías del gerente anterior. Responde `200 OK`.

5. **`ToggleEstadoView`** — `POST /funcionarios/<cod>/estado/` (name `funcionarios_estado`). Permisos: `[NoCambioPendiente, EsRRHH]`. Alterna el estado (`ACTIVO`↔`INACTIVO`), infiriéndolo del estado actual. Al dar de baja: requiere `fecha_baja` y `tipo_baja` válidos; marca el cargo actual como no actual; si el funcionario es `JEFE AREA`, llama `employees.utils.redirigir_jerarquia_por_baja_jefe` para reencauzar a sus subordinados. Al reactivar: opcionalmente recibe nueva `fecha_ingreso`; si se proporciona, borra y repuebla `GestionVacacion` (resetea el cómputo de saldos como reingreso nuevo). Responde `200 OK` con `{'ok': True, 'estado': f.estado}`.

6. **`BuscarFuncionariosView`** — `GET /funcionarios/buscar/` (name `funcionarios_buscar`). Permisos: `[NoCambioPendiente, EsFuncionarioActivo]` (autocomplete genérico para cualquier funcionario activo). Query param `q` (mín. 2 caracteres). Busca con `Q` OR sobre nombre/apellidos/CI (`icontains`), solo `ACTIVO`, limitado a 10 resultados. Devuelve lista simplificada (`cod_funcionario`, `nombre_completo`, `ci`).

7. **`HistorialCargosView`** — `GET /funcionarios/<cod>/historial-cargos/` (name `funcionarios_historial_cargos`). Permisos declarados: `[NoCambioPendiente, EsAuditoria]`, pero además hace un chequeo manual redundante más restrictivo contra `_ROLES_HISTORIAL = {'Administrador', 'Auditoria'}` (excluye a RRHH aunque `EsAuditoria` lo permitiría) — el control efectivo es la intersección de ambos. Trae todos los `HistorialCargo` ordenados por fecha, y el `GestionVacacion` actual. Para el cargo actual muestra saldos vivos; para cargos pasados, los saldos congelados `*_al_salir`. Calcula `saldo_anterior` encadenando cargos consecutivos. Determina `rol_label` según el rol del solicitante.

8. **`VacacionesBajaPDFView`** — `GET /funcionarios/<cod>/vacaciones-baja-pdf/` (name `funcionarios_vacaciones_baja_pdf`). Permisos declarados: `[NoCambioPendiente, EsRRHH]` + chequeo manual redundante. Solo permite generar el PDF para funcionarios `estado='INACTIVO'` (404 si está activo). Genera el PDF vía `_generar_pdf_vacaciones_baja`. Responde `HttpResponse` tipo `application/pdf` con `Content-Disposition: attachment`.

   - **`_generar_pdf_vacaciones_baja(f, gv, cargo)`** (helper, no vista): construye con `reportlab` un "INFORME DE SALDO DE VACACIONES AL CIERRE" con datos del funcionario, logo institucional, datos de la baja, y detalle del saldo de vacaciones al momento de la baja por gestión más el total adeudado.

**Resumen de mapeo permisos/roles para `employees`**: vistas HTML (RRHH/Administrador para funcionarios, Administrador/Auditoria para historial) más doble-chequeo manual; APIs de escritura exigen `EsRRHH`; lectura general (`ListarFuncionariosView`, `BuscarFuncionariosView`) solo exige `EsFuncionarioActivo` pero oculta datos sensibles a quien no sea RRHH; `HistorialCargosView` y `VacacionesBajaPDFView` añaden capa extra manual más estricta. Todas exigen `NoCambioPendiente`.

### employees/urls.py
Define el `urlpatterns` de la app:

| Ruta | Vista | name |
|---|---|---|
| `funcionarios/lista/` | `api_views.ListarFuncionariosView` | `funcionarios_lista` |
| `funcionarios/aprobadores/` | `api_views.AprobadoresView` | `funcionarios_aprobadores` |
| `funcionarios/nuevo/` | `api_views.NuevoFuncionarioView` | `funcionarios_nuevo` |
| `funcionarios/exportar/` | `views.exportar_funcionarios` | `funcionarios_exportar` |
| `funcionarios/buscar/` | `api_views.BuscarFuncionariosView` | `funcionarios_buscar` |
| `funcionarios/<str:cod>/editar/` | `api_views.EditarFuncionarioView` | `funcionarios_editar` |
| `funcionarios/<str:cod>/estado/` | `api_views.ToggleEstadoView` | `funcionarios_estado` |
| `funcionarios/<str:cod>/historial-cargos/` | `api_views.HistorialCargosView` | `funcionarios_historial_cargos` |
| `funcionarios/<str:cod>/vacaciones-baja-pdf/` | `api_views.VacacionesBajaPDFView` | `funcionarios_vacaciones_baja_pdf` |

Nota: las vistas HTML `funcionarios_view` y `historial_cargos_view` de `views.py` están registradas en `config/urls.py` (nivel raíz), no en este archivo; solo `exportar_funcionarios` aparece explícitamente enrutada aquí desde `views.py`.

### employees/apps.py
Configuración estándar: `EmployeesConfig(AppConfig)` con `name = 'employees'`. Sin lógica adicional en `ready()`.

### employees/admin.py
Vacío (boilerplate). Ningún modelo de `employees` está registrado en el admin de Django — coherente con que todos son `managed=False` y la gestión se hace exclusivamente vía las vistas/APIs custom.

### employees/utils.py (136 líneas)
Módulo de funciones helper de dominio:

- **`_inicial(texto)`** (privada): devuelve la primera letra de un texto en mayúscula, normalizando y eliminando diacríticos vía `unicodedata.normalize('NFD', ...)`.

- **`generar_matricula_seguro(persona)`**: genera la matrícula de seguro social con formato codificado: 2 últimos dígitos del año de nacimiento + 2 dígitos de mes (offset `_OFFSET_MES_FEMENINO = 49` para mujeres, diferenciando sexo) + 2 dígitos de día + iniciales de apellido paterno, materno, primer y segundo nombre. Si la matrícula ya existe, añade un sufijo numérico incremental hasta encontrar una libre.

- **`reasignar_aprobador(old_aprobador, new_aprobador, hoy=None)`**: migra todos los registros activos de `JerarquiaAprobacion` (app `vacations`) del aprobador saliente al entrante: desactiva cada registro existente y crea uno nuevo idéntico salvo el aprobador. Se usa al cambiar el titular de un puesto gerencial.

- **`redirigir_jerarquia_por_baja_jefe(jefe, hoy=None)`**: cuando un Jefe de Área es dado de baja, para cada subordinado directo, desactiva todos sus niveles activos de jerarquía y los recrea renumerados desde 1 (saltándose el nivel del jefe ausente) — permite que las solicitudes pendientes sean resueltas por el siguiente aprobador en la cadena.

### employees/tests.py (166 líneas)
Suite de tests DRF (`APITestCase`) que cubre 4 endpoints, usando helpers de `core.test_utils`:

- **`TestListarFuncionariosAPI`**: requiere autenticación, cualquier usuario autenticado puede listar (sin rol específico), estructura de respuesta correcta.
- **`TestNuevoFuncionarioAPI`**: creación exitosa (201), rechazo por CI duplicado, campo requerido faltante, unidad organizacional inexistente, requiere autenticación.
- **`TestToggleEstadoAPI`**: desactivación exitosa, rechazo si falta `fecha_baja`, reactivación exitosa, 404 si `cod` no existe.
- **`TestBuscarFuncionariosAPI`**: estructura de respuesta, búsqueda &lt;2 caracteres devuelve vacío, sin coincidencias devuelve vacío sin error.

No hay tests explícitos para `EditarFuncionarioView`, `AprobadoresView`, `HistorialCargosView` ni `VacacionesBajaPDFView` — cobertura parcial del módulo.

### employees/migrations/
Tres migraciones reales, todas usando `RunSQL` directo (tablas `managed=False`, DDL no autogenerable):

1. **`0001_add_fecha_baja_funcionario.py`**: agrega columna `fecha_baja DATE NULL` a `funcionario`.
2. **`0002_rename_tipo_funcionario_values.py`**: migra `tipo_funcionario` de formato con guiones bajos mayúsculas (`SUBORDINADO`, `JEFE_AREA`, etc.) a formato con espacios (`PERSONAL DE AREA`, `JEFE AREA`, etc.), incluyendo el rename semántico `SUBORDINADO → PERSONAL DE AREA`, ampliando la columna y recreando el `CHECK constraint`.
3. **`0003_add_tipo_baja_funcionario.py`**: agrega columna `tipo_baja VARCHAR(10) NULL` a `funcionario`.

---

## App: reports

### reports/models.py
Vacío (solo boilerplate `from django.db import models` y comentario). La app `reports` no define modelos propios: todas sus consultas leen datos de otras apps (`employees.Funcionario`, `employees.HistorialCargo`, `vacations.GestionVacacion`, `vacations.SolicitudVacacion`, `core.UnidadOrganizacional`, `accounts.FuncionarioRol`) y solo agrega/formatea esa información para presentación. No hay migraciones (`reports/migrations/` no existe siquiera con `0001`, coherente con la ausencia de modelos).

### reports/views.py
Dos vistas HTML mínimas, ambas `@login_required` con control de acceso manual redundante contra `_ROLES_REPORTE_P = {'RRHH', 'Auditoria', 'Administrador'}` (además del middleware `ControlAccesoRoles`, que aplica la misma restricción vía `PERMISOS['reporte_g']`/`PERMISOS['reporte_p']`):

- **`reporte_general_view(request)`**: si el usuario no tiene ninguno de los roles permitidos, `render(..., 'shared/sin_acceso.html', status=403)`; si tiene, renderiza `reports/ReporteG.html` sin contexto de datos (todo se carga vía API en el cliente). Corresponde a `url_name='reporte_g'`.
- **`reporte_personal_view(request)`**: misma guarda, renderiza `reports/ReporteP.html`. Corresponde a `url_name='reporte_p'`.

### reports/api_views.py
Tres endpoints DRF (220 líneas) que alimentan las pantallas de reportes, todos con permisos `[NoCambioPendiente, EsAuditoria]` (`EsAuditoria` requiere `{Auditoria, RRHH, Administrador}`) **más** una verificación manual redundante y más estricta contra `_ROLES_REPORTE_P = {'RRHH', 'Auditoria', 'Administrador'}` idéntica en las tres vistas. Constante adicional `_ROLES_DIAS_PERDIDOS = {'RRHH', 'Administrador'}` que restringe la visibilidad de la columna "días perdidos" a un subconjunto de esos roles (Auditoría puede ver el reporte pero no esa columna sensible).

Helpers de módulo:
- **`_area_label_usuario(roles)`**: traduce el rol del usuario a una etiqueta de área para mostrar en el encabezado del PDF (`Administrador`→"ADMINISTRACIÓN", `RRHH`→"RECURSOS HUMANOS", `Auditoria`→"AUDITORIA"), con prioridad Administrador &gt; RRHH &gt; Auditoria si el usuario tiene varios.
- **`_nombre_rrhh_activo()`**: busca el primer `FuncionarioRol` activo con rol RRHH y devuelve el nombre corto (`nombre + ap_paterno`) del responsable, para la firma del reporte.
- **`_get_funcionario_y_roles(username)`**: helper compartido que resuelve `Funcionario` (`estado='ACTIVO'`) y su set de roles activos; propaga `Funcionario.DoesNotExist` para que cada vista la capture y devuelva 404.

- **`UnidadesReporteView`** — `GET /api/reportes/personal/unidades/` (`rp_unidades`, en `URL_ABIERTAS`). 404 si el usuario no tiene `Funcionario` activo; 403 si sus roles no intersectan `_ROLES_REPORTE_P`. Devuelve el catálogo de `UnidadOrganizacional` activas (para poblar el filtro), más `area_label` y `nombre_rrhh` (metadatos usados por el JS al construir el PDF).

- **`FuncionariosReporteView`** — `GET /api/reportes/personal/funcionarios/` (`rp_funcionarios`, en `URL_ABIERTAS`). El endpoint central de ambos reportes (General y Personal comparten esta misma fuente de datos). Filtros opcionales por query params: `unidad` (id exacto), `tipo_contrato` (busca funcionarios cuyo `HistorialCargo` actual tenga ese tipo, vía subquery de códigos), `funcionario` (búsqueda `icontains` OR sobre nombre/apellido paterno). Para cada funcionario en el resultado, arma un diccionario con datos personales, cargo actual, unidad, fecha de ingreso, y **`gestiones`**: una lista de exactamente 3 entradas correspondientes a los años `[actual, actual-1, actual-2]`, cada una con `{'anio', 'dias'}` extraídos de los 4 slots físicos de `GestionVacacion` (`anio_gestionN`/`dias_gestionN`, sin importar en qué slot numérico estén guardados — se buscan por coincidencia de año real) — esta vista **normaliza** la estructura de slots arbitrarios del modelo a las 3 columnas fijas que muestra la UI de reportes. También incluye `dias_negados` y `dias_adeudados` siempre, y `dias_perdidos` solo si `puede_ver_dias_perdidos` es true. El resultado se ordena descendente por `dias_adeudados`.

- **`HistorialReporteView`** — `GET /api/reportes/personal/historial/` (`rp_historial`, en `URL_ABIERTAS`). Requiere query param `cod` (400 si falta). 404 si el funcionario no existe/no está activo. Trae todas las `SolicitudVacacion` con `estado='APROBADA'` del funcionario, ordenadas por `fecha_salida`, y las agrupa en un diccionario `historial` cuyas claves son el año de salida (string) y los valores listas de `{inicio, fin, dias, nro}` (numeradas secuencialmente dentro de cada año). Devuelve también datos identificatorios del funcionario y su `dias_adeudados` actual. Alimenta el modal de historial de `ReporteP.js`.

### reports/urls.py
Tres rutas, todas bajo `api/reportes/personal/`: `unidades/` (`rp_unidades`), `funcionarios/` (`rp_funcionarios`), `historial/` (`rp_historial`). Las vistas HTML `reporte_general_view`/`reporte_personal_view` se enrutan desde `config/urls.py` raíz.

### reports/apps.py
Configuración estándar: `ReportsConfig(AppConfig)` con `name='reports'`.

### reports/admin.py
Vacío (boilerplate). Sin modelos que registrar.

### reports/tests.py
Vacío (solo `from django.test import TestCase` y comentario). No existe cobertura de tests para esta app — a diferencia de `core`, `accounts`, `employees` y `vacations`, `reports` no tiene ningún test automatizado pese a exponer 3 endpoints DRF con lógica de agregación no trivial (normalización de gestiones, agrupación de historial por año).

---

## App: vacations

### vacations/models.py

Define 5 modelos, todos con `managed = False` (las tablas ya existen en la base de datos PostgreSQL preexistente; Django solo las mapea, no las gestiona vía `migrate` salvo la migración RunSQL puntual mencionada más abajo).

- **`JerarquiaAprobacion`** (`db_table='jerarquia_aprobacion'`): registra quién aprueba a quién. Campos clave: `cod_funcionario` (FK a `employees.Funcionario`, related_name `aprobadores` — el funcionario que es aprobado), `cod_aprobador` (FK al mismo modelo, related_name `es_aprobador_de` — quien aprueba), `nivel_aprobacion` (entero, define el escalón jerárquico: 1, 2, 3), `fecha_inicio` (auto_now_add), `fecha_fin` (nullable — null significa vigente), `activo` (booleano). Es el modelo que sostiene toda la cadena de aprobación multinivel y el historial de cambios de jefatura (cuando cambia un jefe, se cierra el registro viejo con `fecha_fin` y se abre uno nuevo en vez de sobrescribir).

- **`GestionVacacion`** (`db_table='gestion_vacacion'`): es el "saldo" de vacaciones de un funcionario, en relación `OneToOneField` con `employees.Funcionario` (`on_delete=CASCADE`). Guarda hasta 4 "gestiones" (años de antigüedad acreditados) en pares de columnas `dias_gestionN` / `anio_gestionN` (N=1..4, `DecimalField(4,1)`). También tiene `dias_negados` (días descontados por rechazo) y `dias_perdidos` (días caducados por exceder el límite de gestiones activas — ver `utils.py`). El campo más interesante es **`dias_adeudados`**, un `GeneratedField` (columna calculada y persistida por la propia base de datos, `db_persist=True`) que suma `Coalesce(dias_gestion1..4, 0)` — es decir, el total de días disponibles se computa automáticamente en la BD cada vez que cambian las 4 columnas de gestión, sin necesidad de recalcular en Python. Esta es la columna a la que se agregó `dias_perdidos` vía la migración RunSQL (`0001_add_dias_perdidos_gestion.py`).

- **`SolicitudVacacion`** (`db_table='solicitud_vacacion'`): la entidad central del ciclo de vida. Campos: `cod_funcionario` (FK), `fecha_solicitud` (auto_now_add, fecha de negocio de la solicitud), `fecha_salida`/`fecha_retorno` (rango de vacaciones), `dias_solicitados` (Decimal 4,1), `motivo_vacacion` (texto libre opcional), `estado` (CharField, default `'PENDIENTE_JEFE'` — funciona como máquina de estados: `PENDIENTE_JEFE` → …→ `APROBADA` / `RECHAZADA`, aunque los demás valores de estado se manejan como strings libres en `api_views.py`, no como choices formales acá), `fecha_creacion` (DateTimeField auto_now_add, timestamp técnico distinto de `fecha_solicitud`).

- **`AprobacionSolicitud`** (`db_table='aprobacion_solicitud'`): registra cada decisión tomada en la cadena de aprobación. FK a `SolicitudVacacion` (`id_formulario`, CASCADE) y a `Funcionario` (`cod_aprobador`), `nivel` (en qué escalón se tomó la decisión), `decision` (CharField corto, ej. `'APROBADO'`/`'RECHAZADO'`), `fecha_decision` (auto_now_add), `observacion` (texto opcional, usado sobre todo para motivos de rechazo).

- **`AnulacionAjuste`** (`db_table='anulacion_ajuste'`): registra anulaciones o ajustes posteriores a una solicitud ya aprobada/gestionada. FK a `SolicitudVacacion` (`DO_NOTHING`), `tipo_anulacion` (CharField corto, se ve usado como `'AJUSTE'` en `views.py`), `motivo_anulacion` (obligatorio), `observaciones` (opcional), `dias_devolver` (Decimal — cuántos días se le devuelven al saldo del funcionario), `fecha_registro` (auto_now_add), `registrado_por` (FK a `Funcionario`, quien de RRHH hizo el ajuste).

Todas las FK usan `models.DO_NOTHING` (excepto la de `AprobacionSolicitud`→`SolicitudVacacion` que es `CASCADE`), coherente con el patrón de tablas legadas no gestionadas por Django donde la integridad referencial la controla la base de datos, no el ORM.

### vacations/views.py

Archivo de 647 líneas dividido en dos bloques: (1) generación de PDFs con ReportLab (funciones privadas, no vistas HTTP) y (2) vistas de template que renderizan las páginas HTML de la app (las APIs reales viven en `api_views.py`). Importa modelos (`AnulacionAjuste`, `AprobacionSolicitud`, `GestionVacacion`, `JerarquiaAprobacion`), `Funcionario`/`HistorialCargo` de `employees`, y `FuncionarioRol` de `accounts`.

**Constantes de módulo:**
- `_ROLES_HISTORIAL = {'RRHH', 'Administrador'}`: set usado para el control de acceso manual (adicional al middleware) en tres vistas.
- `_PDF_FIRMAS`: diccionario que mapea `tipo_funcionario` (`'PERSONAL DE AREA'`, `'JEFE AREA'`, `'GERENTE ADMINISTRATIVO'`, `'GERENTE SALUD'`, `'DEPENDENCIA DIRECTA'`, `'GERENTE GENERAL'`) a la lista de firmas que debe llevar el formulario PDF según el nivel jerárquico del solicitante — define cuántas y cuáles casillas de firma aparecen en el PDF de aprobación.

**`_check_acceso_historial(request)`**: helper de control de acceso a nivel de vista (redundante/complementario al middleware `ControlAccesoRoles`). Busca el `Funcionario` ACTIVO cuyo CI coincide con `request.user.username` (el username es el número de CI), obtiene sus roles activos vía `FuncionarioRol.objects.filter(cod_funcionario=f, activo=True)` y devuelve `(bool, funcionario)` según si el set de roles interseca con `_ROLES_HISTORIAL`. Si el funcionario no existe o no está ACTIVO, retorna `(False, None)`.

**`_generar_pdf_solicitud(solicitud)`**: función privada (invocada por `api_views.DescargarPDFView`) que construye con ReportLab (`SimpleDocTemplate`, `Table`, `Paragraph`) el **formulario oficial de solicitud de vacaciones** en A4. Lógica destacada:
  - Calcula `dias_efectivos_pdf = solicitud.dias_solicitados - ya_ajustados_pdf`, donde `ya_ajustados_pdf` es la suma (`Sum`) de `dias_devolver` de todos los `AnulacionAjuste` de tipo `'AJUSTE'` asociados a esa solicitud — es decir, resta ajustes posteriores para mostrar el número de días real vigente.
  - Resuelve los **aprobadores vigentes al momento de la solicitud** (no los actuales) iterando niveles 1 a 3 sobre `JerarquiaAprobacion`, filtrando `fecha_inicio__lte=fs`, `cod_aprobador__estado='ACTIVO'` y `(fecha_fin__isnull=True) | (fecha_fin__gt=fs)` — esto evita que aparezca como aprobador alguien que ya fue dado de baja, incluso si su registro de jerarquía no se cerró correctamente en la fecha exacta.
  - Resuelve el responsable de RRHH vigente en la fecha de la solicitud consultando `FuncionarioRol` con `id_roles__tipo_rol='RRHH'` y la misma lógica de vigencia por fechas.
  - Detecta `sin_jefe_area_pdf`: si el solicitante es `'PERSONAL DE AREA'` y no existe ningún `JerarquiaAprobacion` de nivel 1 con aprobador `tipo_funcionario='JEFE AREA'` activo vigente en la fecha — en ese caso reordena las casillas de firma (nivel 1 queda vacío con leyenda "No asignado", y los niveles 1/2 reales de la BD se corren a las posiciones 2/3 del PDF).
  - Si `tipo == 'GERENTE GENERAL'`, imprime una única celda "NO POSEE NIVEL DE APROBACIÓN" en vez de la tabla de firmas.
  - Construye tablas con datos del empleado, período de vacaciones, las 4 gestiones y su saldo (`dias_adeudados`), la cadena de firmas de aprobación y la firma de RRHH, más una nota con la fecha de impresión. Devuelve los bytes del PDF (`buffer.getvalue()`).

**`_generar_pdf_rechazada(solicitud, apr_rechazo)`**: función privada análoga a la anterior pero para el **formulario de solicitud rechazada** (usada por `api_views.DescargarPDFRechazadaView`). Arma una sección "DECISIÓN DE RECHAZO" con cabecera roja (`ERR_RED = #c62828`): nivel en que fue rechazada, quién rechazó, fecha, y el motivo (`observacion`). Si no se pasa `apr_rechazo`, muestra "Sin información de rechazo registrada."

**Vistas de template** (todas decoradas con `@login_required(login_url='login_home')`; el control de rol específico lo aplica el middleware `ControlAccesoRoles` según la matriz de permisos, salvo donde se indica verificación manual adicional):
- **`vacaciones_view(request)`**: renderiza `vacations/Vacaciones.html` sin contexto adicional. Corresponde a `'vacaciones'` (roles: Funcionario, Administrador) — pantalla donde el funcionario crea su solicitud.
- **`historial_solicitudes_view(request)`**: renderiza `vacations/Historial_Solicitudes.html`. Corresponde a `'solicitudes'` (Funcionario, Administrador, Auditoria).
- **`aprobacion_view(request)`**: renderiza `vacations/Aprobación_Rechazo.html`. Corresponde a `'aprobacion'` (Administrador, Jefe de Area, Gerente Administrativo, Gerente de Salud, Gerente General).
- **`historial_rrhh_view(request)`**: llama `_check_acceso_historial(request)`; si no tiene acceso, `sin_acceso.html` 403 (control duplicado defensivo). Renderiza `vacations/Frm_Solicitud.html` — corresponde a `'historial_rrhh'` (RRHH, Administrador).
- **`anulacion_view(request)`**: misma guarda; renderiza `vacations/Anulación.html` — corresponde a `'anulacion'` (RRHH, Administrador).
- **`rechazadas_view(request)`**: misma guarda; renderiza `vacations/Solicitudes_Rechazadas.html`.

Ninguna de estas vistas HTML pasa contexto de datos al template — toda la carga de datos ocurre client-side vía las APIs DRF de `api_views.py`. Su ruteo está en el `urls.py` raíz del proyecto, no en `vacations/urls.py`.

### vacations/api_views.py

Archivo de 1775 líneas que concentra **todos los endpoints DRF (`APIView`)** del módulo de vacaciones. Está organizado en 6 bloques separados por comentarios tipo banner, más una sección inicial de constantes y funciones helper privadas compartidas por todas las vistas.

#### Constantes de dominio

- `_NIVEL_LABELS`: diccionario que mapea `tipo_funcionario` a las etiquetas de cada nivel de aprobación (Jefe de Área, Gerente Adm./Salud, Gerente General). Define cuántos niveles de aprobación jerárquica le corresponden a cada tipo de funcionario: un `PERSONAL DE AREA` normal pasa por 3 niveles; un `JEFE AREA` por 2; cargos de dependencia directa o los propios gerentes van directo a Gerente General o no requieren aprobación (`GERENTE GENERAL` no tiene niveles, `{}`).
- `_NIVEL_COLS`: variante pensada para renderizar columnas en el frontend (con `db_nivel`, `header`, `subtitle`).
- `_ESTADOS_PENDIENTE = ('PENDIENTE_JEFE', 'PENDIENTE_GERENTE_AREA', 'PENDIENTE_GERENTE_GENERAL')`: los tres estados intermedios de una solicitud.
- `_ROLES_APROBADOR` y `_ROLES_RRHH`: sets de nombres de rol usados para checks manuales de autorización adicionales a las permission classes de DRF.
- `_ESTADOS_SIGUIENTE = {1: 'PENDIENTE_GERENTE_AREA', 2: 'PENDIENTE_GERENTE_GENERAL'}`: tabla de transición de estado tras aprobar el nivel 1 o 2.

#### Funciones helper privadas (no son vistas)

- **`_get_funcionario(request)`**: resuelve el `Funcionario` ACTIVO asociado al `request.user.username` (CI). Usada en casi todas las vistas para ubicar "quién soy".
- **`_preview_codigo(funcionario)`**: genera el código previsualizado `G{n:03d}` contando cuántas solicitudes tiene ya el funcionario + 1 (vista previa antes de crear; el código final real usa `id_formulario`, PK autoincremental global).
- **`_estado_display(estado_db)`**: traduce los estados internos a la etiqueta que ve el usuario ("Pendiente", "Aprobada", "Rechazada").
- **`_saldos_para_js(gv)`**: transforma un `GestionVacacion` (4 slots físicos) en una lista de gestiones con saldo &gt; 0 o año asignado, más `dias_negados` y `dias_adeudados`.
- **`_calcular_retorno(fecha_salida, dias_solicitados, fecha_nacimiento, feriados_set)`**: **el corazón del cálculo de fecha de retorno**. Recorre día por día desde `fecha_salida` acumulando `dias_habiles` (Decimal) hasta alcanzar `dias_solicitados`:
  - Fin de semana (`weekday() &gt;= 5`): cuenta `dias_fines_semana`, no consume saldo.
  - Feriado: cuenta `dias_feriados`, no consume saldo.
  - Cumpleaños del funcionario ("medio asueto"): suma solo 0.5 a `dias_habiles`, registrado en `dias_cumpleanos`.
  - Día hábil normal: suma 1.0.
  - Devuelve `fecha_retorno` (primer día después de completar el total solicitado, no incluido en el rango de vacación) junto con los contadores. Soporta días fraccionarios.
- **`_siguiente_dia_habil(fecha, feriados_set)`**: avanza `fecha` mientras sea fin de semana o feriado.
- **`_sumar_meses(fecha, meses)`**: suma meses calendario recortando al último día del mes destino si el día original no existe.
- **`_get_usuario_rrhh(request)`** / **`_check_acceso_historial(request)`**: obtienen el `Funcionario` del request junto con su set de roles activos.
- **`_sin_jefe_area(funcionario)`**: `True` si el funcionario es `PERSONAL DE AREA` y no tiene ningún Jefe de Área activo en su `JerarquiaAprobacion`.
- **`_nivel_cols_dinamico(funcionario)`** / **`_nivel_labels_dinamico(funcionario)`**: versiones "conscientes" de `_NIVEL_COLS`/`_NIVEL_LABELS` que, cuando `_sin_jefe_area()` es `True`, insertan una columna sintética "Jefe de Área — No asignado" y re-etiquetan los niveles siguientes.

#### MÓDULO: SOLICITUD DE VACACIONES

**`DatosFormularioView`** — `GET /api/vacaciones/datos/` (`vac_datos`). Permisos: `NoCambioPendiente`, `EsFuncionarioActivo`. Devuelve todos los datos que necesita el formulario de nueva solicitud: datos personales, fecha de hoy, próximo código previsto, saldos por gestión, jerarquía de aprobadores activa, y flags calculados: `puede_solicitar` (antigüedad ≥ 1 año y `dias_adeudados` &gt; 0), `dias_correspondientes`, `gestiones_con_saldo`, `roles`, `sin_jefe_area`. 404 si el funcionario no existe o no está `ACTIVO`.

**`CalcularRetornoView`** — `POST /api/vacaciones/calcular-retorno/` (`vac_calcular_retorno`). Permisos: `NoCambioPendiente`, `EsFuncionarioActivo`. Body: `fecha_salida`, `dias_solicitados`, `cod_funcionario` (opcional, para regla de cumpleaños). Valida fecha y días&gt;0. Arma el set de feriados desde `Feriado` y llama a `_calcular_retorno`. Responde `fecha_retorno`, `fecha_conclusion`, `dias_fines_semana`, `dias_feriados`, `dias_cumpleanos`, `dias_no_habiles`. Solo cálculo, no persiste nada.

**`CrearSolicitudView`** — `POST /api/vacaciones/crear/` (`vac_crear`). Permisos: `NoCambioPendiente`, `EsFuncionarioActivo`. Body: `fecha_salida`, `fecha_retorno`, `dias_solicitados`, `motivo_vacacion`. Validaciones: campos requeridos, motivo 10-500 caracteres, fechas parseables, días&gt;0 múltiplo de 0.5, funcionario activo, `fecha_salida` no anterior a `fecha_ingreso` ni fecha pasada, debe existir `GestionVacacion`, saldo suficiente, no doble solicitud pendiente. Dentro de `transaction.atomic()`: determina `estado_inicial` (`PENDIENTE_JEFE` si tiene jerarquía activa, si no se autoaprueba `APROBADA`), crea `SolicitudVacacion`, **descuenta el saldo inmediatamente al crear** recorriendo slots del más antiguo al más nuevo (FIFO por antigüedad de gestión). Responde 201 con `id_formulario` y `codigo` real (`G{id:03d}`).

**`MisSolicitudesView`** — `GET /api/vacaciones/mis-solicitudes/` (`vac_mis_solicitudes`). Permisos: `NoCambioPendiente`, `EsFuncionarioActivo`. Auto-fix: si el funcionario ya no tiene niveles de jerarquía activos, actualiza en bloque cualquier solicitud pendiente suya a `APROBADA`. Lista todas sus `SolicitudVacacion` cruzando con `AprobacionSolicitud` y `AnulacionAjuste` tipo `AJUSTE`. Devuelve lista con niveles semánticos, resumen (total, dias_usados, dias_pendientes, dias_adeudados) y `nivel_cols`.

**`SeguimientoSolicitudView`** — `GET /api/vacaciones/seguimiento/` (`vac_seguimiento`). Permisos: `NoCambioPendiente`, `EsFuncionarioActivo`. Toma la solicitud más reciente del funcionario y construye una línea de tiempo (`timeline`) tipo wizard: entrada inicial "Funcionario", entrada sintética "Jefe de Área — No asignado" si `sin_jefe_area`, o "Aprobación automática — Sistema" si no requiere niveles. Recorre la jerarquía marcando `approved`/`rejected`/`pending`/`inactive`. Si no hay solicitud, `{'tiene_solicitud': False}`.

#### MÓDULO: APROBACIÓN Y/O RECHAZO

**`SolicitudesParaAprobarView`** — `GET /api/vacaciones/para-aprobar/` (`vac_para_aprobar`). Permisos: `NoCambioPendiente`, `EsAprobador`. Verifica manualmente `es_admin` vs `tiene_rol_aprobador`. Si tiene rol de aprobador, solo trae solicitudes de sus subordinados en `JerarquiaAprobacion` activa. Si es admin sin rol propio, trae todas las pendientes. Calcula `puede_actuar`: `True` solo si todos los niveles anteriores ya fueron `APROBADO` y el aprobador aún no decidió en su nivel (aprobación secuencial estricta). Construye objeto `flujo` por solicitud.

**`RegistrarDecisionView`** — `POST /api/vacaciones/decision/` (`vac_decision`). Permisos: `NoCambioPendiente`, `EsAprobador`. Body: `id_formulario`, `decision` (`APROBADO`/`RECHAZADO`), `observacion` (obligatoria ≥10 caracteres si rechazo). Valida: solicitud no en estado final, existe `JerarquiaAprobacion` activa vinculando aprobador-solicitante (403 si no), todos los niveles previos aprobados (400 si no), no doble voto. Dentro de `transaction.atomic()`: crea `AprobacionSolicitud`; si `RECHAZADO`, cambia estado a `RECHAZADA` y devuelve los días descontados; si `APROBADO`, si es el último nivel pasa a `APROBADA`, si no avanza vía `_ESTADOS_SIGUIENTE`. Responde `ok`, `decision`, `nuevo_estado`, `codigo`.

#### MÓDULO: GESTIÓN DE SALDO (RRHH)

**`AcreditarGestionView`** — `POST /api/vacaciones/acreditar-gestion/` (`vac_acreditar_gestion`). Permisos: `NoCambioPendiente`, `EsRRHH` + check manual. Body: `cod_funcionario`, `anio_gestion` (2000-año actual). Calcula antigüedad a 31/12 del año de gestión; si &lt;1 año, 400. Calcula días según `dias_por_antiguedad`. Con `select_for_update()`: rechaza si esa gestión ya fue acreditada; busca slot libre; si no hay, evict la más antigua a `dias_perdidos`; asigna la nueva gestión; aplica tope de 2 activas evictando excedentes. Responde 201.

**`InicializarVacacionesView`** — `POST /api/vacaciones/inicializar/` (`vac_inicializar`). Permisos: `NoCambioPendiente`, `EsRRHH`. Body opcional `cod_funcionario` (si se omite, procesa todos los `ACTIVO`). Llama `poblar_gestion_vacacion(f)` por cada uno. Bootstrap/re-sincronización masiva.

#### MÓDULO: HISTORIAL DE SOLICITUDES (RRHH)

**`HistorialRRHHView`** — `GET /api/vacaciones/historial-rrhh/` (`vac_historial_rrhh`). Permisos: `NoCambioPendiente`, `EsRRHH` + `_check_acceso_historial`. Auto-fix de solicitudes pendientes huérfanas. Filtra `SolicitudVacacion` `APROBADA` con filtros opcionales `unidad`, `tipo_contrato`, `funcionario`. Devuelve lista enriquecida con cargo, unidad, fechas, días netos de ajustes, saldo actual, catálogos de filtros.

**`DescargarPDFView`** — `GET /api/vacaciones/historial-rrhh/pdf/&lt;id_formulario&gt;/` (`vac_pdf`). Permisos: `NoCambioPendiente`, `EsRRHH`. Solo permite descargar PDF de solicitudes `APROBADA` (404 si no). Delega en `vacations.views._generar_pdf_solicitud`.

#### MÓDULO: ANULACIÓN Y AJUSTE (RRHH)

**`SolicitudesAnulacionView`** — `GET /api/vacaciones/anulacion/` (`vac_anulacion_list`). Permisos: `NoCambioPendiente`, `EsRRHH`. Lista solicitudes `APROBADA`/`ANULADA`, con saldo actual, días totales netos.

**`RegistrarAnulacionView`** — `POST /api/vacaciones/anulacion/registrar/` (`vac_anulacion_registrar`). Permisos: `NoCambioPendiente`, `EsRRHH`. Body: `id_formulario`, `tipo_anulacion` (`total`/`parcial`), `motivo_anulacion`, `observaciones` (≥20, ≤1000), `dias_devolver` (si parcial). Solo sobre `APROBADA`. Calcula `dias_efectivos` restando ajustes previos (permite múltiples ajustes parciales acumulativos auditados). Crea `AnulacionAjuste`, devuelve días al saldo (mismo patrón FIFO), solo la anulación total cambia el estado a `ANULADA`.

#### MÓDULO: SOLICITUDES RECHAZADAS (RRHH)

**`SolicitudesRechazadasView`** — `GET /api/vacaciones/rechazadas/` (`vac_rechazadas`). Permisos: `NoCambioPendiente`, `EsRRHH`. Lista solicitudes `RECHAZADA` con filtros `unidad`/`funcionario`. Localiza la `AprobacionSolicitud` de rechazo para mostrar nivel, quién y por qué.

**`DescargarPDFRechazadaView`** — `GET /api/vacaciones/rechazadas/pdf/&lt;id_formulario&gt;/` (`vac_pdf_rechazada`). Permisos: `NoCambioPendiente`, `EsRRHH`. Análogo al anterior pero solo `RECHAZADA`, delega en `_generar_pdf_rechazada`.

#### Alertas proactivas para RRHH

**`AlertaGestionesPorPerderView`** — `GET /api/vacaciones/alerta-gestiones-riesgo/` (`vac_alerta_gestiones_riesgo`). Permisos: `NoCambioPendiente`, `EsRRHH`. Constante `_ANTICIPO_RIESGO_MESES = 1`. Detecta funcionarios con las 2 gestiones activas al tope que, dentro del próximo mes, se volverán elegibles para una gestión adicional aún no acreditada (riesgo de evicción a `dias_perdidos`).

**`AlertaPoblarHoyView`** — `GET /api/vacaciones/alerta-poblar-hoy/` (`vac_alerta_poblar_hoy`). Permisos: `NoCambioPendiente`, `EsRRHH`. Lista funcionarios cuyo aniversario de ingreso (ajustado al siguiente día hábil) ya se cumplió y cuya gestión aún no fue acreditada.

### vacations/urls.py

Define exclusivamente el `urlpatterns` de la **API** de la app (todas bajo `api/vacaciones/`), apuntando a clases de `api_views`. Es un archivo de solo 29 líneas, organizado por comentarios de sección:
- **Solicitud de Vacaciones**: `api/vacaciones/datos/` (`vac_datos`), `api/vacaciones/calcular-retorno/` (`vac_calcular_retorno`), `api/vacaciones/crear/` (`vac_crear`), `api/vacaciones/mis-solicitudes/` (`vac_mis_solicitudes`), `api/vacaciones/seguimiento/` (`vac_seguimiento`).
- **Aprobación y/o Rechazo**: `api/vacaciones/para-aprobar/` (`vac_para_aprobar`), `api/vacaciones/decision/` (`vac_decision`).
- **Historial RRHH**: `api/vacaciones/historial-rrhh/` (`vac_historial_rrhh`) y `api/vacaciones/historial-rrhh/pdf/&lt;int:id_formulario&gt;/` (`vac_pdf`).
- **Gestión de saldo (RRHH)**: `api/vacaciones/acreditar-gestion/` (`vac_acreditar_gestion`) y `api/vacaciones/inicializar/` (`vac_inicializar`).
- **Anulación y ajuste (RRHH)**: `api/vacaciones/anulacion/` (`vac_anulacion_list`) y `api/vacaciones/anulacion/registrar/` (`vac_anulacion_registrar`).
- **Solicitudes Rechazadas (RRHH)**: `api/vacaciones/rechazadas/` (`vac_rechazadas`) y `api/vacaciones/rechazadas/pdf/&lt;int:id_formulario&gt;/` (`vac_pdf_rechazada`).
- **Alerta de gestiones a punto de perder días (RRHH)**: `api/vacaciones/alerta-gestiones-riesgo/` (`vac_alerta_gestiones_riesgo`) y `api/vacaciones/alerta-poblar-hoy/` (`vac_alerta_poblar_hoy`).

Todas las vistas API son basadas en clases (`.as_view()`). Las vistas de template se importan (`from . import views, api_views`) pero se enrutan desde el `urls.py` raíz del proyecto.

### vacations/apps.py

Archivo inusualmente extenso para un `apps.py` (68 líneas) porque implementa **auto-inicialización de datos vía señales de Django**. `VacationsConfig.ready()` conecta dos señales:

1. `post_migrate.connect(_auto_poblar_vacaciones, sender=self)`: se ejecuta al final de `manage.py migrate`.
2. `request_started.connect(_auto_poblar_vacaciones_primer_request)`: se ejecuta en el primer request HTTP que recibe el proceso — pensado para entornos donde se levanta el servidor sin correr `migrate` explícitamente después de un deploy.

**`_auto_poblar_vacaciones(sender, **kwargs)`**: función de arranque protegida con `try/except Exception: pass`. Su lógica:
- Itera todos los `Funcionario` con `estado='ACTIVO'`.
- Para cada uno calcula `esperadas = calcular_gestioneS_pendientes(f.fecha_ingreso)`; si no hay gestiones esperadas, lo salta.
- **Solo si el funcionario NO tiene ya un `GestionVacacion`** llama a `poblar_gestion_vacacion(f)` para crearlo. Un comentario extenso explica una decisión de diseño importante: **deliberadamente ya no "corrige" (reset + repoblar)** a funcionarios que ya tienen `GestionVacacion` — porque con el límite de 2 gestiones activas, un funcionario correcto nunca tendrá las 4 gestiones completas, así que esa comparación siempre "fallaría" y el signal terminaría repoblando (y evictando a `dias_perdidos`) en cada reinicio del servidor, **duplicando el descuento de días perdidos cada vez** — este es exactamente el bug de datos que los management commands `diagnosticar_dias_perdidos` y `corregir_dias_perdidos` fueron creados para diagnosticar y reparar.
- Además, crea automáticamente un `django.contrib.auth.models.User` para cada `Funcionario` ACTIVO que no tenga usuario Django todavía, usando como `username` el CI y como password `f.contrasena_hash` (o `'12345678'` si no existe) — sincroniza la tabla legada de funcionarios con el sistema de autenticación de Django en cada migración/arranque.

**`_auto_poblar_vacaciones_primer_request(sender, **kwargs)`**: usa una bandera global de módulo para asegurar que la población automática solo corra **una vez** por proceso, en el primer request HTTP recibido; delega en `_auto_poblar_vacaciones`.

### vacations/admin.py

Archivo trivial: solo el import `from django.contrib import admin` y el comentario boilerplate. Ningún modelo de `vacations` está registrado en el admin de Django — la gestión de estos datos se hace exclusivamente a través de las vistas/APIs de la app y de los management commands.

### vacations/utils.py

Módulo de funciones puras de dominio (180 líneas) que encapsula las reglas de negocio de acreditación de vacaciones según la **Ley General del Trabajo de Bolivia**. Importado tanto por `apps.py` como por los 4 management commands.

- **`calcular_anios_antiguedad(fecha_ingreso, referencia=None)`**: calcula años completos de servicio entre `fecha_ingreso` y `referencia` (por defecto hoy). Descuenta 1 si el mes/día de referencia es anterior al de ingreso. Nunca retorna negativo.

- **`dias_por_antiguedad(anios)`**: tabla de tramos de la ley boliviana — 0 días si `anios &lt; 1`; 15 días si `1 &lt;= anios &lt; 5`; 20 días si `5 &lt;= anios &lt; 10`; 30 días si `anios &gt;= 10`.

- **`calcular_gestioneS_pendientes(fecha_ingreso, hoy=None)`**: función central de cálculo de elegibilidad. Determina la "gestión más reciente válida" según si ya pasó el aniversario este año (maneja el caso de aniversario 29 de febrero cayendo en año no bisiesto). Recorre hacia atrás hasta 4 años consecutivos, descartando años con antigüedad &lt; 1. Devuelve una lista de tuplas `(slot, anio, dias)` donde `slot` va de 4 (más antigua) a 1 (más reciente).

- **`LIMITE_GESTIONES_ACTIVAS = 2`**: constante de negocio — un funcionario solo puede tener 2 gestiones (años) de saldo "vivo" simultáneamente; el resto caduca.

- **`aplicar_limite_gestiones_activas(gv, limite=LIMITE_GESTIONES_ACTIVAS)`**: recorta en memoria las gestiones activas de un `GestionVacacion` al límite indicado. Ordena por año real ascendente, y si hay exceso mueve las gestiones más antiguas a `dias_perdidos` (acumulando), vaciando el slot. Idempotente. Retorna la lista de evicciones aplicadas.

- **`poblar_gestion_vacacion(funcionario)`**: función principal de acreditación. Obtiene o crea el `GestionVacacion`, calcula `calcular_gestioneS_pendientes`, y acredita años nuevos en slots libres (evitando duplicar años ya acreditados). Tras acreditar, aplica `aplicar_limite_gestiones_activas`. Retorna estadísticas: `acreditadas`, `ya_existentes`, `sin_elegibilidad`, `evictadas`.

### vacations/management/commands/poblar_vacaciones.py

Comando operacional (manual/periódico) que **acredita los días de vacación a todos los funcionarios activos**. Argumentos: `--cod &lt;str&gt;` (solo un funcionario), `--dry-run`. Itera funcionarios activos, calcula gestiones candidatas, y en modo normal llama `poblar_gestion_vacacion`, clasificando resultados en `acreditados`/`omitidos`. Idempotente y no destructivo: solo rellena slots vacíos.

### vacations/management/commands/diagnosticar_dias_perdidos.py

Comando de **solo lectura** para detectar el bug del signal `_auto_poblar_vacaciones` (reset+repoblar repetido que infla `dias_perdidos` en cada reinicio). Excluye funcionarios con alguna `SolicitudVacacion` `APROBADA` (el bug nunca los tocó). Para el resto, recalcula desde cero el valor correcto de `dias_perdidos` y compara contra el valor actual, reportando discrepancias. Sin argumentos CLI adicionales. Paso previo de auditoría antes de `corregir_dias_perdidos`.

### vacations/management/commands/corregir_dias_perdidos.py

Comando **destructivo pero acotado** que aplica la corrección detectada por `diagnosticar_dias_perdidos`. Argumento: `--dry-run`. Excluye funcionarios con solicitud `APROBADA`. Para el resto, si hay discrepancia, **resetea los 4 slots** y los reescribe con las gestiones activas correctas, y **fija (no suma)** `dias_perdidos` al valor absoluto correcto (a diferencia de `aplicar_limite_gestiones_activas`, que acumula). Reconfigura stdout/stderr a UTF-8 para evitar errores de consola en Windows.

### vacations/management/commands/migrar_dias_perdidos.py

Comando de **migración de datos "de una sola vez"**, pensado para correr inmediatamente después de la migración de esquema que agrega `dias_perdidos` a `gestion_vacacion`, poblando retroactivamente ese campo en datos preexistentes. Argumentos: `--cod`, `--dry-run`. Reutiliza `aplicar_limite_gestiones_activas` de `utils.py`. Recorta de golpe todas las gestiones que excedían el límite de 2 activas al momento de aplicar la migración.

**Nota sobre migraciones de esquema**: `vacations/migrations/` contiene un único archivo, `0001_add_dias_perdidos_gestion.py`, que agrega la columna `dias_perdidos NUMERIC(4,1)` a `gestion_vacacion` mediante `RunSQL`.

### vacations/tests.py

Archivo de 822 líneas con dos bloques: tests de funciones puras (`TestCase`, prueban helpers de `vacations/utils.py` y `_calcular_retorno`) y tests de API (`APITestCase`, con fixtures de `core.test_utils`).

- **Antigüedad y tabla de días LGT** (`TestCalcularAniosAntiguedad`, `TestDiasPorAntiguedad`): bordes exactos del aniversario, años bisiestos, tabla de días por antigüedad.
- **Cálculo de fecha de retorno** (`TestCalcularRetorno`): casos básicos, efecto de feriados, medio asueto de cumpleaños, días fraccionarios.
- **Gestiones pendientes/elegibilidad** (`TestCalcularGestionesPendientes`): ingreso reciente sin gestiones, 1 año exacto, 4 años completos con slots correctos, 10 años acredita 30 días, máximo 4 gestiones calculadas, día antes del aniversario excluye el año en curso, salto a 20 días a los 5 años.
- **Tope de gestiones activas y evicción** (`TestAplicarLimiteGestionesActivas`): evicción por año real (no por slot), 2 gestiones no evict, idempotencia, persistencia correcta.
- **API calcular-retorno**: requiere auth, 400 con datos incompletos/inválidos, 200 con cálculo correcto, feriado extiende la fecha.
- **API datos del formulario**: requiere auth, datos correctos, `puede_solicitar` correcto, 404 si no hay `Funcionario` asociado.
- **API crear solicitud**: creación exitosa (201), saldo insuficiente (400), motivo corto (400), doble solicitud pendiente bloqueada (400), sin `GestionVacacion` (400).
- **API mis-solicitudes**: lista vacía, solicitud creada aparece con estado traducido.
- **API historial RRHH**: control de acceso por rol (403 sin RRHH, 200 con RRHH).
- **API acreditar gestión**: 403 sin RRHH, evicción correcta de la más antigua al acreditar tercera gestión, segunda gestión no evict.
- **API alerta gestiones en riesgo**: 403 sin RRHH, detección correcta con ventana de anticipo de 1 mes.
- **API alerta poblar hoy**: 403 sin RRHH, aniversario hoy sin acreditar aparece, ya acreditado no aparece, futuro no aparece, ajuste a día hábil si el aniversario cayó en feriado.

---

## config/ (settings raíz del proyecto)

### config/settings.py
Configuración central de Django (194 líneas), cargada con `python-dotenv` (`load_dotenv(BASE_DIR / '.env', encoding='utf-8-sig')`). Puntos relevantes:
- `SECRET_KEY` obligatoria vía variable de entorno; si falta, `ImproperlyConfigured` en el arranque (fail-fast).
- `DEBUG` y `ALLOWED_HOSTS` también desde entorno.
- `INSTALLED_APPS`: las 6 apps del dominio (`accounts`, `dashboard`, `employees`, `vacations`, `reports`, `core`) más `rest_framework`; comentario explícito "como Kronix Core" sugiriendo que la arquitectura de apps replica un proyecto/framework interno previo de la organización.
- `MIDDLEWARE`: stack estándar de Django más `core.middleware.ControlAccesoRoles` al final, con comentario explícito de que debe ir después de `AuthenticationMiddleware`.
- `TEMPLATES`: `APP_DIRS=True` más `DIRS=[BASE_DIR/'templates']`; context processors estándar más los dos custom de `accounts.context_processors` (`foto_perfil`, `permisos_usuario`).
- `DATABASES`: un único backend `postgresql`, todos los parámetros desde variables de entorno con defaults de desarrollo local.
- `AUTH_PASSWORD_VALIDATORS`: los 4 validadores estándar de Django (en la práctica la validación real de complejidad la hace el regex `_PATRON_CONTRASENA` de `accounts/views.py`, no estos validadores).
- `LANGUAGE_CODE='es-ES'`, `TIME_ZONE='America/La_Paz'` (Bolivia), `USE_TZ=True`.
- `REST_FRAMEWORK`: autenticación solo por sesión (`SessionAuthentication`), permiso por defecto `IsAuthenticated` (cada `APIView` sobreescribe con permisos más específicos de `core.api_permissions`), renderer solo JSON, `EXCEPTION_HANDLER` apuntando a `core.api_exceptions.manejar_excepcion`.
- Cabeceras de seguridad: `SESSION_COOKIE_HTTPONLY`, `CSRF_COOKIE_HTTPONLY`, `X_FRAME_OPTIONS='DENY'`, `SECURE_CONTENT_TYPE_NOSNIFF`.
- `TEST_RUNNER = 'core.test_runner.ManagedTestRunner'`.
- `STATIC_URL='/static/'`, `STATICFILES_DIRS=[BASE_DIR/'static']` (un único directorio raíz de estáticos para todas las apps, consistente con `static/js/&lt;app&gt;/*.js`).
- `LOGGING`: logger dedicado `ssu.acceso_denegado` con dos handlers (archivo `logs/acceso_denegado.log` y consola), nivel `WARNING`, usado tanto por el middleware de control de acceso como por el exception handler de API para errores 500.

### config/urls.py
`ROOT_URLCONF`. Incluye (`include(...)`) los `urls.py` de `accounts`, `core`, `employees`, `vacations`, `reports` en la raíz (`''`), y además declara directamente en este archivo las rutas de **vistas HTML basadas en template** que no tienen su propio archivo de rutas de vista: `admin/`, `loging.html` (alias de `login`, `TemplateView` directo), `Index_Principal.html` (`index`, protegida con `login_required` inline), `Perfil.html`/`Contrasena.html`/`Recuperar.html` (accounts), `Feriados.html` (core), `Funcionarios.html`/`HistorialCargos.html` (employees), `Vacaciones.html`/`Solicitudes.html`/`Aprobacion.html`/`FormularioVac.html`/`Anulacion.html`/`HistorialRRHH.html`/`SolicitudesRechazadas.html` (vacations — nótese que `formulario_vac` y `historial_rrhh` apuntan ambos a `vacations_views.historial_rrhh_view`, son alias de la misma vista), `ReporteP.html`/`ReporteG.html` (reports). Patrón notable: las URLs de páginas HTML usan el nombre del archivo `.html` como path literal en vez de rutas REST-friendly, reflejando un estilo de navegación tipo "sitio de páginas" clásico más que SPA.

### config/asgi.py
Boilerplate estándar de Django: expone `application = get_asgi_application()` con `DJANGO_SETTINGS_MODULE=config.settings`. Sin configuración custom de routing ASGI (sin websockets/channels).

### config/wsgi.py
Boilerplate estándar equivalente para despliegue WSGI (el modo de despliegue típico para esta app server-rendered). `application = get_wsgi_application()`.

---

## Frontend JS (static/js/)

### static/js/accounts/Perfil_Usuario.js
Alimenta la pantalla **Perfil de Usuario** (vista de datos personales, foto de perfil, roles asignados e historial de cargos del funcionario).

**Configuración inicial**: lee cuatro meta-tags inyectados por Django (`csrf-token`, `foto-url`, `foto-eliminar-url`, `placeholder-url`) para tener el token CSRF y las URLs de subida/eliminación/placeholder de la foto sin hardcodearlas.

**Subida de foto de perfil**: disparadores: click en `btnUpload` o en `photoOverlay` (abren el selector nativo de archivos), o drag&amp;drop sobre `photoOverlay`. Validaciones cliente: el archivo debe ser `image/*` y no superar 5 MB (si no, `AppDialog.alert`). Si pasa, `FormData` con campo `foto` → `fetch(FOTO_URL, POST, headers X-CSRFToken)`. Éxito: actualiza `profilePhoto.src` con `?v=${Date.now()}` para evitar caché y toast local `mostrarNotificacion(...)`. Error: `AppDialog.alert` con mensaje del backend o de conexión.

**Eliminar foto**: `btnRemove` click → `AppDialog.confirm('¿Está seguro de eliminar su foto de perfil?', {variant:'danger'})`; si confirma, `POST FOTO_DEL_URL` sin body; éxito reemplaza `src` por el placeholder y muestra toast informativo.

**Drag&amp;drop**: intercepta `dragenter/dragover/dragleave/drop` en `photoOverlay` y `document.body` con `preventDefault` para evitar que el navegador abra el archivo; al soltar, asigna los archivos al input y dispara un `change` sintético para reutilizar el flujo de subida.

**Expandir/contraer secciones**: `btnToggleHistorial`/`btnToggleRoles` alternan clase `expanded` y cambian el texto del botón; puramente cosmético, sin llamadas a API.

**`mostrarNotificacion(mensaje, tipo)`**: función local (distinta del sistema global de `shared/notifications.js`) que crea un toast `fixed` arriba a la derecha con color según tipo, autodestruido a los 3 segundos.

No usa librerías externas de terceros.

### static/js/accounts/Recuperar_Contrasena.js
Alimenta la pantalla pública de **Recuperación de Contraseña** (wizard de 2 pasos, sin sesión iniciada).

**Requisitos de contraseña en vivo**: 5 reglas (longitud≥8, mayúscula, minúscula, número, carácter especial) evaluadas en el evento `input` del campo `nuevaContrasena`, activando/desactivando clase `valid` en cada indicador visual; también llama `actualizarMatch()`.

**`actualizarMatch()`**: compara en vivo nueva contraseña vs confirmación en cada `input`, mostrando coincide/no coincide.

**Navegación — `irPaso(id)`**: controla la máquina de estados visual del wizard (steps `step2`, `stepOk`).

**PASO 1 — Verificar identidad** (`formStep1` submit): `POST /recuperar/verificar/` con `{ci, fecha_nacimiento, matricula_seguro}`. Éxito: avanza a `step2`. Error: mensaje inline. Deshabilita botón mientras espera.

**PASO 2 — Nueva contraseña** (`formStep2` submit): valida regex de complejidad y coincidencia en cliente antes de tocar el servidor. Si pasa, `POST /recuperar/nueva/` con `{nueva, confirmar}`. Éxito: avanza a `stepOk` y redirige automáticamente al login tras 3 segundos (`setTimeout`).

**`toggleVis(inputId, iconId)`**: alterna visibilidad de contraseña.

No usa `AppDialog`; solo mensajes de error inline dentro del propio formulario.

### static/js/accounts/Seguridad.js
Alimenta la pantalla de **Seguridad / Cambio de Contraseña** para un usuario ya autenticado (pide la contraseña actual, a diferencia del flujo de recuperación público).

**Configuración**: lee `csrf-token`, `cambio-contrasena-url`, y opcionalmente `redirect-post-cambio`.

**`togglePassword(inputId)`**: alterna visibilidad.

**`validarFortaleza()`**: calcula puntaje 0-6 (longitud≥8/≥12, minúscula, mayúscula, número, especial) y pinta una barra con clases `strength-weak/medium/strong`.

**`validarRequisitos()`**: mismas 5 reglas de complejidad, activa clase `valid` por requisito.

**`validarCoincidencia()`**: compara nueva vs confirmación en vivo.

**`validarFormulario()`**: revalida todo en el submit (no confía solo en los indicadores visuales) antes de enviar.

**`cambiarContrasena()`** (submit del form): valida, deshabilita botón, `POST` al endpoint dinámico con `{actual, nueva, confirmar}`. Si hay `REDIRECT_POST` configurado, muestra `AppDialog.alert` de éxito y redirige tras cerrarlo; si no, limpia el formulario y muestra alerta inline de éxito.

**`cancelar()`**: si hay cambios sin guardar, pide confirmación vía `AppDialog.confirm` antes de limpiar el formulario.

Usa `window.AppDialog` para confirmaciones/éxito modal, combinado con alertas inline propias para errores de validación.

### static/js/accounts/movimiento.js
Alimenta la pantalla de **Login**. No realiza ninguna llamada a API — es puramente decorativo/UX (animaciones de entrada del contenedor, paneles izquierdo/derecho con efecto escalonado, escala de inputs en focus/blur y del botón en hover). El envío de credenciales se maneja en otro lugar; este script es solo microinteracciones visuales.

### static/js/core/Feriados.js
Alimenta la pantalla de **Gestión de Feriados** (CRUD, roles Administrador/RRHH).

**Configuración**: meta-tags `csrf-token`, `url-lista`, `url-agregar`, `url-base-feriado`.

**Inicialización**: `_initPerfil()` (`GET /api/usuario/mi-perfil/` → integra `profile-switcher`) y `buscarFeriados()`.

**Listar/buscar — `buscarFeriados()`**: disparado por `btnBuscar`, cambio de `searchTypeSelect`, y carga inicial. `GET ${URL_LISTA}?anio=...&amp;tipo=...`. Renderiza tabla con fecha formateada, descripción, tipo y botones editar/eliminar.

**Agregar feriado**: valida campos requeridos en cliente, `POST ${URL_AGREGAR}` con `{fecha, descripcion, tipo}`. Éxito: resetea formulario, refresca tabla, `AppDialog.alert` de éxito.

**Editar** (delegación de eventos en `tableBody`): click en `.btn-edit` → `abrirModalEdicion(id)` lee los valores **directamente de la fila ya renderizada** (sin GET extra), precarga el modal; submit del modal → `POST editarUrl(id)` con `{fecha, descripcion, tipo}` (POST, no PUT/PATCH, patrón consistente del proyecto). Éxito: cierra modal, refresca tabla, alerta de éxito.

**Eliminar**: click en `.btn-delete` guarda `pendingDeleteId` y abre modal de confirmación; `confirmDeleteBtn` → `POST eliminarUrl(id)` sin body; éxito cierra modal y refresca tabla.

No usa librerías externas; depende de `AppDialog` y opcionalmente `profile-switcher`.

### static/js/dashboard/Index_Principal.js
Alimenta la pantalla **Dashboard/Página Principal** (home tras login: sidebar, carrusel informativo y alertas proactivas de vacaciones para RRHH/Administrador).

**Sidebar**: toggle colapsar/expandir en escritorio, apertura/cierre en móvil con overlay, submenús expandibles, marcado de ítem activo al navegar.

**Logout**: `btnLogout` click → `AppDialog.confirm('¿Estás seguro que deseas cerrar sesión?', {variant:'danger'})`; si confirma, `AppDialog.alert` de éxito y redirige a `/loging.html`. No se observa llamada a un endpoint de logout real en este archivo — el bloque solo maneja UI/confirmación y redirección.

**Carrusel**: autoplay cada 5000ms (pausado en hover), navegación con flechas e indicadores.

**Alertas proactivas de vacaciones** (visibles solo para RRHH/Administrador, backend responde 403 para otros roles):
- `verificarAlertasVacaciones()`: en paralelo `GET /api/vacaciones/alerta-gestiones-riesgo/` y `GET /api/vacaciones/alerta-poblar-hoy/`. Muestra widgets flotantes con `crearWidgetAlerta` (trigger colapsado con contador + panel expandible con tabla).
- **Flujo "Poblar ahora"**: click en botón de fila del widget → `POST /api/vacaciones/inicializar/` con `{cod_funcionario}`; éxito elimina las filas de ese funcionario en todos los widgets donde aparezca y actualiza contadores (cierra el widget si queda vacío).

No usa librerías externas para carrusel/alertas; usa `AppDialog` para el logout y `fetch` nativo para el resto.

### static/js/reports/ReporteG.js
Alimenta la pantalla de **Reporte General** de personal (listado agregado de todos los funcionarios con días de vacación pendientes por gestión, filtros y exportación a PDF; RRHH/Auditoria/Administrador).

**Inicialización — `init()`**: `cargarPerfil()` → `cargarUnidades()` → `cargarFuncionarios()`.
- `cargarPerfil()`: `GET /api/usuario/mi-perfil/`, integra profile-switcher.
- `cargarUnidades()`: `GET /api/reportes/personal/unidades/`, guarda `area_label`/`nombre_rrhh` (para el PDF) y llena el select de unidad organizacional.
- `cargarFuncionarios(params)`: `GET /api/reportes/personal/funcionarios/?{qs}`. Determina si el usuario puede ver "Días Perdidos" (`data.puede_ver_dias_perdidos`), calcula las 3 últimas gestiones (año actual, -1, -2) y renderiza tabla.

**Modo "gestión única"**: checkbox que colapsa la tabla a una sola columna de gestión filtrando por año ingresado (validado 2000-2099).

**Filtros**: por tipo de contrato y unidad organizacional, recarga vía API.

**Exportar PDF General — `generarPDFGeneral(datos)`**: construye un documento HTML completo standalone (cabecera institucional, logo, tabla, firma de RRHH), lo abre en ventana nueva (`document.write`) con `window.onload=()=&gt;window.print()` — exportación a PDF vía diálogo de impresión del navegador, sin librerías externas.

### static/js/reports/ReporteP.js
Alimenta la pantalla de **Reporte Personal** (vista detallada por funcionario individual: gestiones, historial de solicitudes, Acta de Vacaciones en PDF y descarga de historial en PDF).

**Inicialización**: igual patrón que `ReporteG.js` (`cargarPerfil` → `cargarUnidades` → `cargarFuncionarios`), mismos endpoints.

**`cargarFuncionarios`**: `GET /api/reportes/personal/funcionarios/?{qs}`, actualiza cabeceras de gestión (año actual, -1, -2) y renderiza tabla con celdas de gestión, días negados (con tooltip informativo), días adeudados totales y botones de acción por fila (`data-action="pdf"` genera Acta, `data-action="historial"` abre modal).

**Filtros**: por unidad, tipo de contrato y nombre de funcionario.

**Modal de historial**: click en ícono → `abrirHistorial(cod)` → `GET /api/reportes/personal/historial/?cod=${cod}`; agrupa por gestión, permite filtrar por rango de años (`anioDesde`/`anioHasta` validado), muestra tabla de solicitudes aprobadas por gestión. Botón para descargar el historial completo en PDF (mismo mecanismo de ventana nueva + `window.print()`).

**Generación de Acta de Vacaciones — `generarActaPDF(f)`**: documento tipo "planilla" con columnas de gestión reales del funcionario, columna opcional "VACACIONES NEGADAS", columna "ADEUDADO", y bloques de firma de RRHH y del propio funcionario.

No usa librerías de terceros para PDF (ni jsPDF ni html2canvas); todo el módulo de reportes usa HTML+CSS impreso vía `window.print()` en ventana nueva.

### static/js/shared/notifications.js
Sistema compartido de **diálogos modales de confirmación/alerta** (reemplazo estilizado de `confirm`/`alert` nativos), expuesto como `window.AppDialog` y usado por prácticamente todos los demás módulos.

**Arquitectura (IIFE)**: crea perezosamente un overlay+diálogo (header con ícono+título, cuerpo, footer con botones cancelar/confirmar), generado con `document.createElement`.

**Cola — `enqueue(fn)`**: encadena promesas para mostrar los diálogos uno a la vez si se invocan casi simultáneamente.

**API pública**:
- **`AppDialog.confirm(message, options)`**: Promise que resuelve `true`/`false` según el botón presionado. Opciones: `title`, `confirmText`, `cancelText`, `icon`, `variant` (`info`/`danger`/`success`).
- **`AppDialog.alert(message, options)`**: Promise que resuelve `true` al cerrar (solo botón confirmar).

**Interacción/accesibilidad**: click fuera del diálogo = cancelar; `Escape` cancela, `Enter` confirma; maneja foco (guarda y restaura `document.activeElement`).

Usado extensivamente para notificaciones de error/éxito y confirmaciones destructivas (eliminar foto, eliminar feriado, cerrar sesión, cancelar formulario con cambios). No es un sistema de toast auto-cerrable; requiere interacción explícita.

### static/js/shared/profile-switcher.js
Módulo compartido del **selector de rol activo** para usuarios con múltiples roles, en el header de casi todas las pantallas.

**Configuración estática**: `window.ROLE_DESTINATIONS` (mapea cada rol a su módulo HTML "hogar", ej. Funcionario→`/Vacaciones.html`, RRHH→`/Anulacion.html`), `window.ROLE_ICONS`, `_MODULO_ROLES` (roles preferidos por página, para decidir qué rol mostrar activo).

**`window.profileSwitcherGetRedirect(rol)`**: URL de redirección para el módulo hogar de un rol, o `null` si ya está en esa página.

**`window.detectarRolActual(roles)`**: determina qué rol mostrar como activo según la página actual y los roles preferidos configurados para ella.

**`window.initProfileSwitcher({roles, nombre, rolActual})`**: función principal, invocada por cada módulo tras su propio `GET /api/usuario/mi-perfil/` (este archivo no hace fetch propio). Rellena nombre abreviado, rol activo, y construye la lista de roles disponibles (Funcionario siempre primero, resto alfabético). Click en un rol de la lista: si pertenece a otro módulo, navega (`window.location.href`); si es del módulo actual, solo actualiza la UI localmente (no hay persistencia en backend del "rol activo").

**`window.setupProfileToggle()`**: abre/cierra el panel desplegable de perfil, cierra al hacer click fuera.

No hace ninguna llamada `fetch` propia — depende de que cada pantalla obtenga los datos de usuario y se los pase.

### static/js/employees/Funcionarios.js
Alimenta la pantalla de gestión de funcionarios (listado, alta, edición, baja/reactivación, exportación) usada por RRHH/Administrador. Meta-tags: `csrf-token`, `url-lista`, `url-aprobadores`, `url-nuevo`, `url-exportar`, `url-base-funcionario`.

**Inicialización**: `cargarTabla()` y `cargarPerfil()` (`GET /api/usuario/mi-perfil/` → profile-switcher). Buscador con sugerencias en vivo.

**Tabla principal**: `cargarTabla(q)` → `GET ${URL_LISTA}?estado=${tabActual}&amp;q=...`. `actualizarContadores()` hace dos GET en paralelo (ACTIVO/INACTIVO) solo para contadores de pestañas. `renderizarTabla` muestra columnas distintas según pestaña (en INACTIVO agrega fecha/tipo de baja y botón PDF; en ACTIVO muestra antigüedad).

**Pestañas ACTIVO/INACTIVO**: `cambiarTab(estado)` alterna columnas visibles y recarga.

**Autocompletado**: debounce 250ms sobre `GET /funcionarios/buscar/?q=...`, dropdown de sugerencias resaltadas.

**Baja/reactivación**: `cambiarEstado(cod, estadoActual)` abre modal de baja (fecha+tipo de baja obligatorios) o reactivación (fecha de ingreso opcional). `POST /funcionarios/<cod>/estado/` con los datos correspondientes.

**Descarga PDF de cierre de vacaciones** (solo en pestaña INACTIVO): crea un `&lt;a&gt;` invisible hacia `/funcionarios/<cod>/vacaciones-baja-pdf/` y simula click (PDF generado por el backend).

**Exportación**: modal de filtros (unidad/estado/cargo) → abre `${URL_EXPORTAR}?...` en pestaña nueva.

**Alta/edición**: modal con formulario completo. `abrirEditar(cod)` busca el funcionario en ACTIVO e INACTIVO, precarga campos, roles y jerarquía de aprobadores.

**Jerarquía dinámica de aprobadores — `actualizarJerarquia()`**: al cambiar tipo de funcionario, `GET ${URL_APROBADORES}?excluir=<cod>` (cacheado), construye dinámicamente 0-3 selects de aprobador según el tipo (Gerente General, Gerente Adm/Salud, Dependencia Directa, Jefe de Área, Personal de Área) y marca el checkbox de rol correspondiente.

**Submit**: arma el payload completo (datos personales, contrato, unidad, tipo, roles, jerarquia) y hace `POST` a `editarUrl(cod)` o `URL_NUEVO` según el modo. Éxito: cierra modal, recarga tabla, muestra alerta (incluye matrícula de seguro asignada en alta).

No usa librerías externas de UI ni date-pickers; usa `AppDialog` y el `profile-switcher` compartido.

### static/js/employees/HistorialCargos.js
Alimenta la pantalla de **Historial de Cargos** (RRHH/Auditoría): búsqueda de funcionario y visualización de la evolución de cargos y saldos de vacaciones por gestión, con exportación a PDF.

**Autocompletado**: debounce 260ms sobre `GET /funcionarios/buscar/?q=...`; selección de sugerencia dispara `cargarFuncionario(cod)`.

**Carga**: `GET /funcionarios/<cod>/historial-cargos/`, guarda `cargosDelFuncionario` y `rolLabel` (usado en el PDF).

**Renderizado**: banner con avatar/cargo actual/fecha de ingreso; por cada cargo del historial, un bloque con rango de fechas, badge "Actual", saldo total, y tabla de gestiones (más columna "Saldo Anterior" de referencia si no es el primer cargo, no sumada al total).

**PDF**: `generarPlanillaPDF()` construye HTML con estilos embebidos (cabecera institucional, ficha del funcionario, bloques por cargo, firma), abierto en ventana nueva con `window.print()` tras 500ms. Sin librería de PDF.

Vista de solo lectura/consulta, sin formularios de edición de cargos.

### static/js/vacations/Vacaciones.js
Alimenta la pantalla donde el **Funcionario** consulta su saldo de vacaciones y crea una nueva solicitud, con seguimiento (timeline) de su última solicitud.

**Carga inicial — `cargarDatosFormulario()`**: `GET /api/vacaciones/datos/`. Si `sin_jefe_area`, muestra alerta visual. Prellena datos de solo lectura (contrato, nombre, fecha de ingreso, próximo código). Calcula mínimo de fecha de salida (máximo entre fecha de ingreso y hoy). Renderiza saldos por gestión con notificación de urgencia según `gestiones_con_saldo` (2+ gestiones = mensaje "URGENTE" rojo). Si `puede_solicitar` es false, deshabilita el submit y explica el motivo. Llama `cargarSeguimiento()`.

**Cálculo de fecha de retorno (debounce 400ms)**: al cambiar fecha de salida o días, `POST /api/vacaciones/calcular-retorno/` con `{fecha_salida, dias_solicitados, cod_funcionario}`; si falla la red, cae a un cálculo local simplificado (solo salta fines de semana, sin feriados ni cumpleaños).

**Validación y modal de resumen — `manejarEnvioFormulario`**: intercepta el submit y valida en cadena (motivo≥10 caracteres, fecha de salida no anterior a ingreso ni a hoy, días&gt;0, días≤saldo disponible, retorno ya calculado); si todo pasa, muestra modal de resumen con días no hábiles/cumpleaños/feriados y fecha de conclusión.

**Envío — `enviarSolicitud()`**: `POST /api/vacaciones/crear/` con `{fecha_salida, fecha_retorno, dias_solicitados, motivo_vacacion}`. Éxito: alerta con código de solicitud y recarga la página tras 1.8s.

**Seguimiento (timeline) — `cargarSeguimiento()`**: `GET /api/vacaciones/seguimiento/`, construye lista visual del progreso de aprobación (approved/rejected/pending/sent/inactive).

No usa librerías externas; el cálculo de días hábiles delega primero en el backend.

### static/js/vacations/Aprobación_Rechazo.js
Alimenta la pantalla donde un aprobador (Jefe de Área, Gerente Administrativo, Gerente de Salud, Gerente General) revisa solicitudes pendientes de su nivel y las aprueba/rechaza.

**Carga — `cargarSolicitudes()`**: `GET /api/vacaciones/para-aprobar/`; sincroniza profile-switcher con el rol del aprobador; guarda `todasLasSolicitudes` y `contadores`.

**Filtros**: en memoria, por funcionario y fecha desde (sin llamada a API).

**Tabla**: por cada solicitud muestra un resumen visual del flujo de aprobación (íconos por nivel: check verde/aprobado, rojo/rechazado, reloj naranja/pendiente actual, candado gris/aún no le toca) y botón "ver" solo si `puede_actuar` es true (decidido por el backend).

**Modal de revisión**: detalle completo de la solicitud y del flujo por nivel. Selección de acción (aprobar/rechazar) con confirmación en dos pasos; rechazo exige comentario ≥10 caracteres.

**Ejecución — `ejecutarDecision()`**: `POST /api/vacaciones/decision/` con `{id_formulario, decision, observacion}`. Éxito: alerta con resultado y recarga tras 1.6s.

Un único endpoint de decisión maneja tanto aprobación como rechazo, diferenciado por el campo `decision`. Sin librerías externas.

### static/js/vacations/Historial_Solicitudes.js
Alimenta la pantalla "Mis Solicitudes" del **Funcionario**: historial completo de sus propias solicitudes, con pestañas de estado, buscador y exportación a PDF.

**Carga — `cargarSolicitudes()`**: `GET /api/vacaciones/mis-solicitudes/`; guarda `resumenGlobal` (días usados/pendientes/adeudados) y `nivelCols` (columnas dinámicas según el tipo de jerarquía del funcionario — 3 niveles para Personal de Área, menos para gerentes).

**Cabecera dinámica**: la tabla construye columnas por cada nivel de aprobación aplicable al funcionario.

**Pestañas**: todas/aprobada/rechazada/pendiente, con contadores.

**Filtrado**: combina pestaña + texto de búsqueda en memoria.

**PDF**: `generarPlanillaPDF()` construye documento HTML con tarjetas de resumen y tabla completa en landscape, abierto en ventana nueva con `window.print()`. Sin librería de PDF.

### static/js/vacations/Anulación.js
Alimenta la pantalla de **RRHH** para anular solicitudes ya aprobadas (total o parcialmente), devolviendo días al saldo del funcionario.

**Carga — `_cargarSolicitudes()`**: `GET /api/vacaciones/anulacion/`.

**Búsqueda**: filtro en memoria por funcionario y rango de fechas, en tiempo real (sin llamada a API).

**Modal de anulación**: al elegir tipo "parcial", muestra input de días con máximo = días totales; recalcula el resumen (días a devolver, saldo proyectado) en vivo. Validación: motivo obligatorio, observaciones ≥20 caracteres, días entre 1 y el total si es parcial.

**Confirmación en dos pasos y envío — `procesarAnulacion()`**: `POST /api/vacaciones/anulacion/registrar/` con `{id_formulario, tipo_anulacion, motivo_anulacion, observaciones, dias_devolver}`. Éxito: recarga la lista completa desde el servidor (no muta localmente) y alerta con los días devueltos.

### static/js/vacations/Solicitudes_Rechazadas.js
Alimenta la pantalla de **RRHH** que lista solicitudes rechazadas, con filtros server-side (unidad/funcionario) y descarga del formulario de rechazo en PDF vía modal de confirmación (reforzado en un commit reciente).

**Carga — `cargarDatos(params)`**: `GET /api/vacaciones/rechazadas/?...`. Renderiza tabla con badge de motivo de rechazo, aprobador que rechazó, fecha y observación.

**Delegación de eventos** sobre el `tbody` para capturar clicks en `.btn-pdf` (soporta re-render dinámico).

**Modal de descarga**: `abrirModal(id, nombre, fecha)` arma mensaje personalizado de confirmación; `confirmarDescarga()` crea un `&lt;a&gt;` invisible hacia `/api/vacaciones/rechazadas/pdf/<id>/` y simula click (PDF generado por el backend, no en cliente).

**Filtros**: server-side, a diferencia de otras pantallas del módulo que filtran en memoria.

### static/js/vacations/Frm_Solicitud.js
**Nota**: pese al nombre (que sugeriría un formulario de solicitud), el contenido real implementa la pantalla de **RRHH** de "Historial de Vacaciones Aprobadas" (confirmado con la plantilla HTML asociada, cuyo título es "Historial de Solicitudes de Vacación") — estructuralmente casi idéntica a `Solicitudes_Rechazadas.js` pero para solicitudes en estado aprobado. No existe en el proyecto un formulario/modal reutilizable de creación de solicitud separado de `Vacaciones.js`; la creación vive enteramente allí.

**Carga — `cargarDatos(params)`**: `GET /api/vacaciones/historial-rrhh/?...`. Combos de filtro por unidad organizacional y tipo de contrato.

**Tabla**: código, funcionario, cargo, fechas, días, saldo de días adeudados, botón de descarga PDF.

**Modal de descarga**: mismo patrón que `Solicitudes_Rechazadas.js`, apuntando a `/api/vacaciones/historial-rrhh/pdf/<id>/`.

Sin librerías externas; el PDF es generado por el backend.
