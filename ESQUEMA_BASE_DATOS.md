# Esquema de la Base de Datos — CORE_SSU_v2

Motor: PostgreSQL. Base de datos `db_core_ssu` (compartida con `CORE_SSU` v1 — misma instancia,
`localhost:5432`). La mayoría de las tablas ya existían antes del proyecto Django y se mapean con
`managed=False` (Django no crea ni altera su esquema); la única tabla de dominio que Django gestiona
con migraciones propias es `intentos_acceso`.

## Índice
- [App `core`](#app-core)
- [App `employees`](#app-employees)
- [App `accounts`](#app-accounts)
- [App `vacations`](#app-vacations)
- [Tablas estándar de Django / DRF](#tablas-estándar-de-django--drf)
- [Tablas sin modelo Django (huérfanas)](#tablas-sin-modelo-django-huérfanas)
- [Diferencias entre v1 y v2](#diferencias-entre-v1-y-v2)

---

## App `core`

### `unidad_organizacional`
Modelo: `core.UnidadOrganizacional`. Unidades/áreas de la institución a las que pertenece cada funcionario.

| Columna | Tipo | Null | Default | Descripción |
|---|---|---|---|---|
| id_unidad | integer (PK) | No | secuencia | Identificador de la unidad. |
| nombre | varchar(100) | No | — | Nombre de la unidad, único. |
| descripcion | varchar(255) | Sí | — | Descripción libre. |
| activo | boolean | No | true | Si la unidad sigue vigente (soft-delete). |

### `feriado`
Modelo: `core.Feriado`. Feriados usados para ajustar fechas de retorno de vacaciones y aniversarios de ingreso al siguiente día hábil.

| Columna | Tipo | Null | Default | Descripción |
|---|---|---|---|---|
| id_feriado | integer (PK) | No | secuencia | Identificador. |
| fecha | date | No | — | Fecha del feriado, única. |
| descripcion | varchar(100) | No | — | Nombre del feriado. |
| tipo | varchar(20) | No | — | Uno de: `Internacional`, `Nacional`, `Departamental`, `Municipal`, `Institucional`. |

### `intentos_acceso`
Modelo: `core.IntentosAcceso` (única tabla de dominio con `managed=True` y migración propia: `core/migrations/0001_intentos_acceso.py`). Auditoría de accesos denegados por falta de permisos.

| Columna | Tipo | Null | Default | Descripción |
|---|---|---|---|---|
| id | integer (PK) | No | auto | Identificador. |
| username | varchar(50) | No | — | CI del usuario que intentó acceder. |
| path | varchar(255) | No | — | Ruta HTTP solicitada. |
| url_name | varchar(100) | Sí | — | Nombre de la URL (`name=` en `urls.py`). |
| roles | varchar(255) | Sí | — | Roles que tenía el usuario al momento del intento. |
| ip | inet | Sí | — | IP de origen. |
| timestamp | timestamptz | No | auto (now) | Momento del intento. Orden por defecto: descendente. |

---

## App `employees`

### `persona`
Modelo: `employees.Persona`. Datos personales, independientes de si la persona es funcionario.

| Columna | Tipo | Null | Default | Descripción |
|---|---|---|---|---|
| ci | varchar(20) (PK) | No | — | Carnet de identidad — identificador natural de la persona. |
| nombre | varchar(50) | No | — | Nombre(s). |
| ap_paterno | varchar(50) | No | — | Apellido paterno. |
| ap_materno | varchar(50) | Sí | — | Apellido materno. |
| fecha_nacimiento | date | No | — | Usada para el descuento de 0.5 día de cumpleaños al calcular el retorno de vacaciones. |
| sexo | varchar(10) | No | — | `Masculino` o `Femenino`. |
| foto | bytea | Sí | — | Foto de perfil almacenada como binario directamente en la BD. |

### `funcionario`
Modelo: `employees.Funcionario`. Es el "usuario" del sistema: `request.user.username` se corresponde con `funcionario.ci` (vía `Persona`) y determina identidad y permisos.

| Columna | Tipo | Null | Default | Descripción |
|---|---|---|---|---|
| cod_funcionario | varchar(20) (PK) | No | secuencia | Código interno del funcionario. |
| ci | varchar(20) (FK → `persona.ci`, único) | No | — | Relación 1 a 1 con `Persona`. |
| matricula_seguro | varchar(20) | Sí | — | Matrícula de seguro social, única. |
| id_unidad | integer (FK → `unidad_organizacional`) | No | — | Unidad a la que pertenece. |
| fecha_ingreso | date | No | — | Fecha de ingreso — base de todos los cálculos de antigüedad y vacaciones. |
| tipo_funcionario | varchar(25) | No | — | Uno de: `PERSONAL DE AREA`, `JEFE AREA`, `DEPENDENCIA DIRECTA`, `GERENTE ADMINISTRATIVO`, `GERENTE SALUD`, `GERENTE GENERAL`. Determina el flujo de aprobación y el formulario PDF que le corresponde. |
| estado | varchar(10) | No | `'ACTIVO'` | Solo los funcionarios `ACTIVO` participan del poblado automático de vacaciones. |
| contrasena_hash | varchar(255) | No | — | Hash de contraseña propio del sistema (aparte también existe un `auth_user` espejo para el login de Django). |
| fecha_registro | timestamp | Sí | now() | Cuándo se registró en el sistema. |
| fecha_baja | date | Sí | — | Fecha de baja, si aplica. |
| tipo_baja | varchar(10) | Sí | — | `Despido`, `Renuncia` o `Muerte`. |

### `historial_cargo`
Modelo: `employees.HistorialCargo`. Historial de cargos/contratos de un funcionario y snapshot del saldo de vacaciones al dejar cada cargo.

| Columna | Tipo | Null | Default | Descripción |
|---|---|---|---|---|
| id_historial | integer (PK) | No | secuencia | Identificador. |
| cod_funcionario | varchar(20) (FK → `funcionario`) | No | — | Funcionario al que pertenece el registro. |
| cargo | varchar(100) | No | — | Nombre del cargo. |
| tipo_contrato | varchar(30) | No | — | Tipo de contrato asociado a ese cargo. |
| fecha_inicio / fecha_fin | date | No / Sí | — | Vigencia del cargo (`fecha_fin` null = cargo abierto). |
| es_actual | boolean | No | true | Si es el cargo vigente actualmente. |
| saldo_gestionN_al_salir (N=1..4) | numeric(4,1) | Sí | — | Fotografía del saldo de cada gestión al momento de dejar el cargo. |
| anio_gestionN_al_salir (N=1..4) | integer | Sí | — | A qué año correspondía ese saldo. |

---

## App `accounts`

### `roles`
Modelo: `accounts.Roles` (⚠️ el nombre de la clase es `Roles` pero apunta a la tabla `roles` — no confundir con las tablas huérfanas `accounts_role` / `accounts_userrole`, ver más abajo). Catálogo de roles funcionales (RRHH, Administrador, Auditoría, Jefe de Área, etc.).

| Columna | Tipo | Null | Default | Descripción |
|---|---|---|---|---|
| id_roles | integer (PK) | No | secuencia | Identificador. |
| tipo_rol | varchar(50) | No | — | Nombre del rol, único. |
| descripcion | varchar(255) | Sí | — | Descripción del rol. |

### `funcionario_rol`
Modelo: `accounts.FuncionarioRol`. Asignación de roles a funcionarios, con vigencia temporal — permite reconstruir "quién tenía tal rol en tal fecha" (usado para el historial de aprobadores/RRHH).

| Columna | Tipo | Null | Default | Descripción |
|---|---|---|---|---|
| id_func_rol | integer (PK) | No | secuencia | Identificador. |
| cod_funcionario | varchar(20) (FK → `funcionario`) | No | — | A quién se le asigna el rol. |
| id_roles | integer (FK → `roles`) | No | — | Qué rol. |
| fecha_asignacion | date | No | hoy | Desde cuándo tiene el rol. |
| fecha_revocacion | date | Sí | — | Hasta cuándo (null = sigue vigente). |
| activo | boolean | No | true | Vigencia rápida sin recalcular fechas. |
| asignado_por | varchar(20) (FK → `funcionario`) | Sí | — | Quién hizo la asignación. |

---

## App `vacations`

### `jerarquia_aprobacion`
Modelo: `vacations.JerarquiaAprobacion`. Define, por funcionario, quién es su aprobador en cada nivel de la cadena de aprobación de vacaciones, con vigencia temporal.

| Columna | Tipo | Null | Default | Descripción |
|---|---|---|---|---|
| id_jerarquia | integer (PK) | No | secuencia | Identificador. |
| cod_funcionario | varchar(20) (FK → `funcionario`) | No | — | Funcionario subordinado. |
| cod_aprobador | varchar(20) (FK → `funcionario`) | No | — | Su aprobador. |
| nivel_aprobacion | integer | No | — | Nivel en la cadena (1, 2, 3…). El flujo es secuencial y bloqueante: el nivel N no se activa hasta que el N-1 aprueba. |
| fecha_inicio | date | No | hoy | Desde cuándo aplica esta relación. |
| fecha_fin | date | Sí | — | Hasta cuándo (null = vigente). |
| activo | boolean | No | true | Vigencia rápida. |

### `gestion_vacacion`
Modelo: `vacations.GestionVacacion`. El "saldo" de vacaciones de cada funcionario — una fila por funcionario (`OneToOne`), con hasta 4 "gestiones" (años) acreditadas simultáneamente.

| Columna | Tipo | Null | Default | Descripción |
|---|---|---|---|---|
| id_gestion | integer (PK) | No | secuencia | Identificador. |
| cod_funcionario | varchar(20) (FK → `funcionario`, único) | No | — | Un registro por funcionario. |
| dias_gestionN (N=1..4) | numeric(4,1) | No | 0 | Días acreditados en el slot N. |
| anio_gestionN (N=1..4) | integer | Sí | — | A qué año/gestión corresponde ese slot (null = slot vacío). El número de slot **no** refleja antigüedad real — se asigna al primer slot libre que encuentra el código. |
| dias_negados | numeric(4,1) | No | 0 | Días descontados por solicitudes rechazadas u otros ajustes negativos. |
| dias_adeudados | numeric(4,1) | Sí | — | Columna **generada por PostgreSQL** (`GENERATED ALWAYS AS`, `db_persist=True` en el modelo) = suma de `dias_gestion1..4`. Nunca se escribe desde código, solo se lee. |
| dias_perdidos | numeric(4,1) | No | 0 | Días perdidos por evicción automática cuando el funcionario supera el tope de **2 gestiones activas** simultáneas (`aplicar_limite_gestiones_activas()` en `vacations/utils.py`). Se actualiza automáticamente cada vez que se acredita una gestión nueva que empuja a la más antigua fuera del tope. **Esta columna no existe en el modelo de v1** — ver [Diferencias entre v1 y v2](#diferencias-entre-v1-y-v2). |

### `solicitud_vacacion`
Modelo: `vacations.SolicitudVacacion`. Cada solicitud de vacaciones de un funcionario ("formulario").

| Columna | Tipo | Null | Default | Descripción |
|---|---|---|---|---|
| id_formulario | integer (PK) | No | secuencia | Identificador. |
| cod_funcionario | varchar(20) (FK → `funcionario`) | No | — | Quién solicita. |
| fecha_solicitud | date | No | hoy | Cuándo se creó la solicitud. |
| fecha_salida / fecha_retorno | date | No | — | Rango de vacaciones. `fecha_retorno` se calcula descontando fines de semana, feriados y el medio día de cumpleaños. |
| dias_solicitados | numeric(4,1) | No | — | Cantidad de días solicitados. |
| motivo_vacacion | text | Sí | — | Motivo, opcional. |
| estado | varchar(30) | No | `'PENDIENTE_JEFE'` | Uno de: `PENDIENTE_JEFE`, `PENDIENTE_GERENTE_AREA`, `PENDIENTE_GERENTE_GENERAL`, `APROBADA`, `RECHAZADA`, `ANULADA` — según el nivel de aprobación pendiente o la resolución final. |
| fecha_creacion | timestamp | Sí | now() | Timestamp de creación (distinto de `fecha_solicitud`, que es solo la fecha). |

### `aprobacion_solicitud`
Modelo: `vacations.AprobacionSolicitud`. Una fila por cada nivel de aprobación ya resuelto sobre una solicitud.

| Columna | Tipo | Null | Default | Descripción |
|---|---|---|---|---|
| id_aprobacion | integer (PK) | No | secuencia | Identificador. |
| id_formulario | integer (FK → `solicitud_vacacion`) | No | — | A qué solicitud pertenece. |
| cod_aprobador | varchar(20) (FK → `funcionario`) | No | — | Quién decidió. |
| nivel | integer | No | — | En qué nivel de la cadena se tomó esta decisión. |
| decision | varchar(10) | No | — | `APROBADO` o `RECHAZADO`. |
| fecha_decision | timestamp | No | now() | Cuándo se decidió. |
| observacion | text | Sí | — | Comentario del aprobador (la vista exige mínimo 10 caracteres si es rechazo; no hay constraint a nivel de BD). |

### `anulacion_ajuste`
Modelo: `vacations.AnulacionAjuste`. Anulación total o ajuste parcial de una solicitud ya aprobada, devolviendo días al saldo.

| Columna | Tipo | Null | Default | Descripción |
|---|---|---|---|---|
| id_anulacion_ajuste | integer (PK) | No | secuencia | Identificador. |
| id_formulario | integer (FK → `solicitud_vacacion`) | No | — | Solicitud afectada. |
| tipo_anulacion | varchar(10) | No | — | `ANULACION` (se anula completa) o `AJUSTE` (se acorta/ajusta parcialmente). |
| motivo_anulacion | text | No | — | Motivo obligatorio. |
| observaciones | text | Sí | — | Notas adicionales. |
| dias_devolver | numeric(4,1) | No | 0 | Días que se devuelven al saldo de `gestion_vacacion`. |
| fecha_registro | timestamp | Sí | now() | Cuándo se registró. |
| registrado_por | varchar(20) (FK → `funcionario`) | Sí | — | Quién hizo la anulación/ajuste (típicamente RRHH). |

---

## Tablas estándar de Django / DRF
No son específicas del dominio, las gestiona 100% el framework: `auth_user`, `auth_group`,
`auth_permission`, `auth_group_permissions`, `auth_user_groups`, `auth_user_user_permissions`,
`django_admin_log`, `django_content_type`, `django_migrations`, `django_session`.

`auth_user.username` se hace coincidir con el CI del funcionario para poder iniciar sesión (ver patrón
de autenticación del proyecto); el resto de estas tablas se usa de forma estándar y no tiene lógica de
negocio propia.

## Tablas sin modelo Django (huérfanas)
`accounts_role` y `accounts_userrole` existen físicamente en la base de datos:

- `accounts_role`: `id`, `nombre`, `descripcion`, `activo`, `fecha_creacion`, `fecha_actualizacion`.
- `accounts_userrole`: `id`, `fecha_asignacion`, `rol_id` (FK → `accounts_role`), `usuario_id` (FK → `auth_user`, único).

**Ningún modelo, vista, migración ni código actual las referencia** (verificado con búsqueda en todo el
repositorio). Todo indica que son un remanente de una implementación de roles anterior, basada en
`auth_user` en vez de en `Funcionario`/`cod_funcionario` (el patrón que terminó usando el sistema, con
las tablas `roles` y `funcionario_rol` de arriba). No asumir que están en uso — confirmar con quien las
haya creado antes de modificarlas, migrarles datos o borrarlas.

## Diferencias entre v1 y v2
`CORE_SSU` (v1) y `CORE_SSU_v2` comparten la misma base de datos física (`db_core_ssu` en
`localhost:5432`) y prácticamente el mismo esquema. La única diferencia de esquema es la columna
`dias_perdidos` de `gestion_vacacion`: existe físicamente en la BD (por ser compartida) pero **el
modelo de v1 no la declara** — v1 no tiene el concepto de "tope de gestiones activas" ni evicción
automática, que es exclusivo de v2. Ver `CORE_SSU/PLAN_UNIFICACION_V1_V2.md` para el detalle completo
de en qué más difieren ambas versiones a nivel de código (no de esquema).
